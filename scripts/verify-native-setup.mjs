import { sign } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OWNER_ID, requirePeople } from './native-api.mjs';

const permissions = { contents: 'write', pull_requests: 'write', checks: 'write', actions: 'write', administration: 'read' };
const repoName = 'kingslayerrq/heritage-devlog';
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const safeName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 100) : '';

function appJwt(appId, privateKey, now) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iat: now - 60, exp: now + 480, iss: String(appId) });
  try { return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), privateKey.replace(/\\n/g, '\n')).toString('base64url'); }
  catch { throw new Error('DEVLOG_APP_PRIVATE_KEY is not a usable RSA PEM private key.'); }
}

async function request(fetch, url, options, label) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error(label + ' request failed; endpoint credentials were not logged.'); }
  if (!response.ok) throw new Error(label + ' returned HTTP ' + response.status + '.');
  try {
    if (Number(response.headers.get('content-length')) > 1024 * 1024) throw new Error();
    const text = await response.text();
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error();
    return JSON.parse(text);
  } catch { throw new Error(label + ' returned an invalid or oversized JSON response.'); }
}

export async function verifySetup({ env = process.env, fetch = globalThis.fetch, log = console.log, now = Math.floor(Date.now() / 1000) } = {}) {
  if (env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== repoName || Number(env.GITHUB_ACTOR_ID) !== OWNER_ID) {
    throw new Error('Setup verification must run from main as the repository owner.');
  }
  if (!/^[1-9]\d*$/.test(env.DEVLOG_APP_ID || '') || !env.DEVLOG_APP_PRIVATE_KEY || !env.DEVLOG_APP_TOKEN) {
    throw new Error('Publishing App ID, private key and installation token are required.');
  }
  const appId = Number(env.DEVLOG_APP_ID), jwt = appJwt(appId, env.DEVLOG_APP_PRIVATE_KEY, now);
  const github = (path, token) => request(fetch, 'https://api.github.com' + path, { method: 'GET', headers: {
    Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
  } }, 'GitHub metadata');
  const app = await github('/app', jwt);
  if (app.id !== appId) throw new Error('The private key authenticates a different GitHub App.');
  const installations = await github('/app/installations?per_page=100', jwt);
  if (!Array.isArray(installations) || installations.length !== 1) throw new Error('The publishing App must have exactly one installation.');
  const installation = await github('/repos/' + repoName + '/installation', jwt);
  if (installation.app_id !== appId || installation.id !== installations[0].id ||
      String(installation.id) !== env.DEVLOG_INSTALLATION_ID || installation.account?.login !== repoName.split('/')[0] ||
      installation.suspended_at || installation.repository_selection !== 'selected') {
    throw new Error('The publishing App installation identity, selection or active status is incorrect.');
  }
  for (const [name, level] of Object.entries(permissions)) {
    const actual = installation.permissions?.[name];
    if (actual !== level && !(level === 'read' && actual === 'write')) throw new Error('Publishing App requires ' + name + ': ' + level + '.');
  }
  const repositories = await github('/installation/repositories?per_page=100', env.DEVLOG_APP_TOKEN);
  if (repositories.total_count !== 1 || repositories.repositories?.length !== 1 || repositories.repositories[0].full_name !== repoName) {
    throw new Error('Install the publishing App only on ' + repoName + '.');
  }
  const result = { app: { id: app.id, name: safeName(app.name), installationId: installation.id, repository: repoName }, webhooks: [] };
  log(JSON.stringify({ check: 'publishing-app', status: 'verified', ...result.app }));
  for (const name of ['DISCORD_DEVLOG_ALERTS_WEBHOOK', 'DISCORD_DEVLOG_WEBHOOK']) {
    let url;
    try { url = new URL(env[name]); } catch { throw new Error(name + ' must contain a Discord webhook URL.'); }
    const match = /^\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/[\w.-]+$/.exec(url.pathname);
    if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) ||
        url.username || url.password || url.port || url.hash || url.search || !match) throw new Error(name + ' is not a supported Discord webhook URL.');
    const webhook = await request(fetch, url, { method: 'GET' }, name + ' metadata');
    if (webhook.type !== 1 || webhook.id !== match[1] || !snowflake(webhook.channel_id) || !snowflake(webhook.guild_id)) {
      throw new Error(name + ' must be an incoming guild-channel webhook.');
    }
    const metadata = { setting: name, id: webhook.id, name: safeName(webhook.name), guildId: webhook.guild_id, channelId: webhook.channel_id };
    result.webhooks.push(metadata);
    log(JSON.stringify({ check: 'webhook', status: 'verified', ...metadata }));
  }
  if (result.webhooks[0].guildId !== result.webhooks[1].guildId) throw new Error('Both report webhooks must belong to the same Discord guild.');
  if (env.REQUIRE_INTEGRATION === 'false') {
    result.integration = { status: 'skipped', reason: 'Bot integration check was explicitly disabled; publishing readiness is unverified.' };
  } else {
    if (!env.DEVLOG_INTEGRATION_URL || !env.DEVLOG_INTEGRATION_TOKEN) throw new Error('The deployed bot integration URL and shared token are required.');
    let origin;
    try { origin = new URL(env.DEVLOG_INTEGRATION_URL); } catch { throw new Error('The bot integration origin is invalid.'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash ||
        !['', '/'].includes(origin.pathname) || env.DEVLOG_INTEGRATION_TOKEN.length < 32) throw new Error('The bot integration needs an HTTPS origin and a token of at least 32 characters.');
    const response = await request(fetch, new URL('/api/devlog-integration', origin), { method: 'POST', headers: {
      Authorization: 'Bearer ' + env.DEVLOG_INTEGRATION_TOKEN, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ action: 'people' }) }, 'Bot integration');
    const people = requirePeople(response.people);
    result.integration = { status: 'verified', authors: people.length };
  }
  log(JSON.stringify({ check: 'bot-integration', ...result.integration }));
  log('Metadata verification finished. No Discord message, post or repository change was made.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifySetup(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
