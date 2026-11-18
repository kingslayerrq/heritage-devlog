import { reportKey } from './native-api.mjs';

const id = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const quiet = { parse: [], users: [], roles: [] };
const destinations = new Map();

async function request(url, fetch, method = 'GET', body) {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Discord rejected ' + method + ' (' + response.status + ').'),
    { status: response.status, discordCode: data?.code });
  return data;
}

export async function webhookDestination(webhook, fetch = globalThis.fetch) {
  const url = new URL(webhook);
  const match = /^\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/[\w.-]+$/.exec(url.pathname);
  if (!match || url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) throw new Error('Invalid Discord webhook configuration.');
  if (fetch === globalThis.fetch && destinations.has(webhook)) return destinations.get(webhook);
  const data = await request(url, fetch);
  if (data?.id !== match[1] || !id(data.channel_id) || !id(data.guild_id)) throw new Error('Discord webhook destination could not be verified.');
  const destination = { webhookId: data.id, channelId: data.channel_id, guildId: data.guild_id };
  if (fetch === globalThis.fetch) destinations.set(webhook, destination);
  return destination;
}

const unknownMessage = error => error.status === 404 && error.discordCode === 10008;
const urlFor = (webhook, message) => new URL(webhook + (message ? '/messages/' + message : ''));
const acknowledge = (value, expected, channel, webhookId) => {
  if (!id(value?.id) || (expected && value.id !== expected) || value.channel_id !== channel || value.webhook_id !== webhookId)
    throw new Error('Discord returned no matching message receipt.');
  return value;
};

/** Reserve the article before touching Discord. All webhook tokens remain in the publishing workflow. */
export async function writeCard({ integration, webhook, destination, repo, item, kind, event = '', revision, operation, payload, parentKey,
  lineage, legacyKeys = [], legacyEventKey, order = process.env.GITHUB_RUN_ID, fetch = globalThis.fetch }) {
  destination ||= await webhookDestination(webhook, fetch);
  const { channelId, guildId, webhookId } = destination;
  const cardKey = reportKey(repo, item, channelId);
  const key = reportKey('card-v1', cardKey, operation, kind, event, lineage || '', revision);
  const reserved = await integration({ action: 'reserve-card', key, cardKey, revision, operation, order, ...destination,
    ...(lineage ? { lineage } : {}), ...(parentKey ? { parentKey } : {}), ...(legacyEventKey ? { legacyEventKey } : {}), ...(legacyKeys.length ? { legacyKeys } : {}) });
  if (['skipped', 'sent'].includes(reserved.state)) return { ...reserved, key };
  if (reserved.state !== 'reserved' || !reserved.reservation) throw new Error('Inspect the pending Discord report before retrying. REPORT_KEY=' + key);
  const receipt = { key, reservation: reserved.reservation };
  const complete = (outcome, messageId) => integration({ action: 'complete-card', ...receipt, outcome, ...(messageId ? { messageId } : {}) });
  let message = reserved.messageId, existing = Boolean(reserved.existing), creating = false, posted = false;
  try {
    if (!message && operation !== 'reply') {
      for (const candidate of reserved.legacyMessageIds || []) {
        if (!id(candidate)) throw new Error('Invalid legacy Discord receipt.');
        let prior;
        try { prior = await request(urlFor(webhook, candidate), fetch); }
        catch (error) { if (unknownMessage(error)) continue; throw error; }
        acknowledge(prior, candidate, channelId, webhookId);
        if ((operation === 'resolve' || operation === 'warn') && !/^(❌ 内容检查未通过|⚠️ 内容检查提醒|🔒 修改范围不允许|💥 发布流程失败)(?: ·|$)/u.test(prior.embeds?.[0]?.title || '')) continue;
        const sameEvent = candidate === reserved.legacyEventMessageId;
        await integration({ action: 'adopt-card', ...receipt, messageId: candidate, sameEvent });
        message = candidate; existing = !sameEvent; break;
      }
    }
    if (operation === 'resolve' && !message) return integration({ action:'no-warning-card', ...receipt });
    const reply = operation === 'reply';
    let threadId;
    if (reply) {
      const thread = await integration({ action: 'ensure-card-thread', ...receipt });
      if (!id(thread.threadId)) throw new Error('Discord thread could not be confirmed.');
      threadId = thread.threadId;
    }
    const write = async () => {
      const edit = message && !reply;
      if (edit && operation === 'private' && reserved.preserveWarning) {
        return acknowledge(await request(urlFor(webhook, message), fetch), message, channelId, webhookId);
      }
      let body = payload;
      if (typeof payload === 'function') {
        const previous = edit ? acknowledge(await request(urlFor(webhook, message), fetch), message, channelId, webhookId) : null;
        body = payload(previous);
      }
      if (edit) body = { ...body, content: '', allowed_mentions: quiet, attachments: [] };
      const url = urlFor(webhook, edit ? message : null);
      if (!edit) url.searchParams.set('wait', 'true');
      if (reply) url.searchParams.set('thread_id', threadId);
      creating = !edit;
      const response = await request(url, fetch, edit ? 'PATCH' : 'POST', body);
      posted = creating;
      return acknowledge(response, edit ? message : null, threadId || channelId, webhookId);
    };
    let sent;
    try { sent = await write(); }
    catch (error) {
      if (!message || reply || !unknownMessage(error)) throw error;
      const cleared = await integration({ action: 'missing-card', ...receipt, messageId: message });
      if (operation === 'resolve') return cleared;
      message = null; existing = false;
      sent = await write();
    }
    const confirmed = await complete('sent', sent.id);
    return { existing, messageId: sent.id, rootId: reply ? threadId : sent.id, channelId, guildId, preserveWarning:reserved.preserveWarning, ...confirmed, key };
  } catch (error) {
    const definite = !creating || (!posted && error.status >= 400 && error.status < 500);
    // A lost completion response might follow a committed receipt. A conflicting completion is harmless.
    await complete(definite ? 'failed' : 'uncertain').catch(() => {});
    throw new Error('Discord card delivery requires inspection or retry. REPORT_KEY=' + key, { cause: error });
  }
}

export function revisionReply(payload) {
  const embed = payload.embeds[0];
  const fields = embed.fields.filter(field => field.name === '链接');
  return { content: payload.content, allowed_mentions: payload.allowed_mentions,
    embeds: [{ title: embed.title, color: embed.color, fields, ...(embed.description ? { description:embed.description } : {}),
      ...(embed.url ? { url: embed.url } : {}), timestamp: embed.timestamp }] };
}

export async function sendItemCard(options) {
  const root = await writeCard(options);
  if (root.state === 'skipped' || !root.existing || (options.operation !== 'publish' && !root.preserveWarning && !options.payload.content)) return root;
  const reply = await writeCard({ ...options, operation: 'reply', kind: options.operation + '-' + options.kind,
    parentKey:root.key, legacyKeys: [], legacyEventKey: undefined, payload: revisionReply(options.payload) });
  if (reply.state === 'skipped') return reply;
  const thread = reply.rootId || root.messageId;
  return { ...root, successUrl: 'https://discord.com/channels/' + root.guildId + '/' + thread + '/' + reply.messageId };
}
