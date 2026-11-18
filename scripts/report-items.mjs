import { reportKey } from './native-api.mjs';
import { makeReport } from './report-discord.mjs';
import { sendItemCard, writeCard } from './report-cards.mjs';

const articleItem = value => 'article:' + value;
const prItem = pr => 'pr:' + pr;
export const workflowItem = (context, scope) => 'workflow:' + (context.workflow || 'unknown') + ':' + scope;
const notionItem = source => source.entryId || (source.pageId && 'notion-' + source.pageId.replace(/-/g, ''));
const lineage = (context, item) => reportKey('lineage', context.repo, context.source?.pageId
  ? 'notion:' + context.source.pageId.replace(/-/g, '') : context.pr ? prItem(context.pr) :
    item.startsWith('workflow:') ? item + ':run:' + context.runId : item);
const sourceOrder = (context, item = '') => String(item.startsWith('workflow:') ? context.runId :
  context.source?.createdAt || context.runCreatedAt || context.runId);
const metadata = context => ({ ...context, revision: context.head, actorId: context.actor.id,
  actorLogin: context.actor.login, sourceUrl: context.source?.sourceUrl });

// A removal is public. Only the previous public article may supply its display metadata.
export function removalReport(context, before) {
  const authors = Array.isArray(before?.data.authors) ? before.data.authors : [];
  const reported = makeReport({ ...metadata(context), sourceUrl:undefined, kind:'edit', authors,
    title:before?.data.title, summary:'此日志已从公开网站移除。' });
  const credited = authors.map(author => context.people.find(person => person.author === author)).filter(Boolean);
  reported.content = credited.map(person => '<@' + person.discord + '>').join(' ');
  reported.allowed_mentions = { parse:[], users:credited.map(person => person.discord) };
  reported.embeds[0].fields = [];
  if (!credited.length) delete reported.embeds[0].author;
  return reported;
}

// An issue on an unrelated site file belongs to the PR or workflow, even if it also edits an article.
export function warningGroups(context, issues, scope) {
  const articles = context.articles || [], groups = new Map();
  for (const problem of issues) {
    const article = articles.find(entry => entry.path === problem.path) ||
      (articles.length === 1 && !problem.path ? articles[0] : null);
    const sourceItem = context.source && notionItem(context.source);
    const item = article ? articleItem(article.id) : sourceItem ? articleItem(sourceItem) :
      context.pr ? prItem(context.pr) : workflowItem(context, scope);
    if (!groups.has(item)) groups.set(item, { item, article, issues: [] });
    groups.get(item).issues.push(problem);
  }
  return [...groups.values()];
}

export async function warnItems({ context, kind, issues, scope, webhook, integration, fetch, send = sendItemCard }) {
  const groups = warningGroups(context, issues, scope);
  for (const group of groups) {
    const card = makeReport({ ...metadata(context), kind, issues: group.issues,
      authors: group.article?.authors || context.authors, title: group.article?.title || context.title, sourceOnly: context.sourceOnly });
    card.embeds[0].title = card.embeds[0].title.replace(' ', ' 待处理 · ');
    const legacyEventKey = groups.length === 1 ? reportKey(context.repo, kind, scope, context.head) : null;
    await send({ integration, webhook, fetch, repo: context.repo, item: group.item, kind, event: scope, revision: context.head, operation: 'warn',
      order: sourceOrder(context, group.item), lineage: lineage(context, group.item), payload: card,
      ...(legacyEventKey ? { legacyEventKey, legacyKeys: [legacyEventKey] } : {}) });
  }
}

export function legacyArticleKeys(repo, kind, item, current, older) {
  const keys = new Set([reportKey(repo, kind, item, current)]);
  for (const revision of older) {
    if (!/^[a-f0-9]{40}$/.test(revision)) continue;
    for (const prior of kind === 'private' ? ['private'] : ['publish', 'edit']) keys.add(reportKey(repo, prior, item, revision));
    if (keys.size >= 30) break;
  }
  return [...keys].slice(0, 32);
}

function legacyWarnings(context, item) {
  const keys = [];
  const add = (scope, revision) => {
    if (!/^[a-f0-9]{40}$/.test(revision || '')) return;
    for (const kind of ['warning', 'validation', 'policy', 'deployment']) keys.push(reportKey(context.repo, kind, scope, revision));
  };
  if (context.source?.id && item.startsWith('article:')) {
    add('notion:' + context.source.id, context.source.head);
    add('notion:' + context.source.id, context.source.sourceDigest?.slice(0, 40));
  }
  if (context.reviewHead && context.pr && (context.singleArticle ? item.startsWith('article:') : item === prItem(context.pr))) {
    add(prItem(context.pr), context.reviewHead);
    add('merge:' + context.pr, context.reviewHead);
  }
  return keys;
}

export async function publishItem({ context, kind, item, payload, older, webhook, integration, send = sendItemCard }) {
  const legacyKeys = legacyArticleKeys(context.repo, kind, item, context.head, older);
  return send({ integration, webhook, repo: context.repo, item: articleItem(item), kind, revision: context.head,
    operation: kind === 'private' ? 'private' : 'publish', order: kind === 'private' ? sourceOrder(context) : String(context.runCreatedAt || context.runId), payload,
    legacyKeys, legacyEventKey: legacyKeys[0] });
}

export function resolutionPayload(message, successUrl, when = new Date(), otherUrls = [], status = '发布成功') {
  const previous = message?.embeds?.[0];
  if (!previous) throw new Error('The original warning details are unavailable.');
  const fields = previous.fields || [];
  const linkLabel = { '已保存为私密':'查看私密确认', '已从公开网站移除':'查看移除确认' }[status] || '查看发布消息';
  const links = ['[' + linkLabel + '](' + successUrl + ')', ...otherUrls.slice(0, 6).map((url, i) => '[发布消息 ' + (i + 2) + '](' + url + ')')].join(' · ');
  const originalTitle = previous.title?.replace(/^✅ 已解决 · (发布成功|已保存为私密|已从公开网站移除|网站更新成功) · /, '').replace(' 待处理 · ', ' ');
  return { embeds: [{ ...previous, title: ('✅ 已解决 · ' + status + (originalTitle ? ' · ' + originalTitle : '')).slice(0, 256),
    color: 0x2ecc71, fields: [{ name: '发布结果', value: '✅ ' + status + ' · <t:' + Math.floor(when.getTime() / 1000) + ':f> · ' + links + '\n原检查详情保留如下。' },
      ...fields.filter(field => field.name !== '发布结果')] }] };
}

/** Resolve only an alert for the same reviewed PR, Notion source, or confirmed deployment run. */
export async function resolveItem({ context, item, success, messages = [], privateSuccess = false, webhook, integration, resolve = writeCard }) {
  if (!success?.messageId || !success.guildId || !success.channelId || success.state !== 'sent') return;
  const messageUrl = receipt => receipt.successUrl || 'https://discord.com/channels/' + receipt.guildId + '/' + receipt.channelId + '/' + receipt.messageId;
  const url = messageUrl(success);
  const others = messages.filter(receipt => receipt.state === 'sent' && receipt.guildId === success.guildId && receipt !== success).map(messageUrl);
  const withdrawals = messages.length ? messages.filter(receipt => receipt.withdrawn).length : Number(Boolean(success.withdrawn));
  const status = privateSuccess ? '已保存为私密' : withdrawals === 0 ? '发布成功' : withdrawals === (messages.length || 1) ? '已从公开网站移除' : '网站更新成功';
  await resolve({ integration, webhook, repo: context.repo, item, kind: 'resolution', revision: context.head, operation: 'resolve',
    legacyKeys:legacyWarnings(context, item), order: sourceOrder(context, item), lineage: lineage(context, item),
    payload: previous => resolutionPayload(previous, url, new Date(), others, status) });
}

export const articleWarningItem = articleItem;
