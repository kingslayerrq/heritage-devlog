import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { verifySetup } from '../scripts/verify-native-setup.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const repo = 'kingslayerrq/heritage-devlog', appId = 5721562;
const env = {
  GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: repo, GITHUB_ACTOR_ID: '22969898',
  DEVLOG_APP_ID: String(appId), DEVLOG_APP_PRIVATE_KEY: privateKey,
  DEVLOG_APP_TOKEN: 'installation-secret', DEVLOG_INSTALLATION_ID: '12',
  DISCORD_DEVLOG_ALERTS_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/alerts-secret',
  DISCORD_DEVLOG_WEBHOOK: 'https://discord.com/api/webhooks/223456789012345678/publish-secret',
  DEVLOG_INTEGRATION_URL: 'https://dispatch.example.test', DEVLOG_INTEGRATION_TOKEN: 'integration-secret'.repeat(3),
};
const permissionSet = { contents: 'write', pull_requests: 'write', checks: 'write', actions: 'write', administration: 'read' };
function fixture({ overrides = {}, config = {}, failNetwork = false } = {}) {
  const requests = [], logs = [], data = {
    '/app': { id: appId, name: 'Publisher' },
    '/app/installations?per_page=100': [{ id: 12 }],
    ['/repos/' + repo + '/installation']: { id: 12, app_id: appId, account: { login: 'kingslayerrq' }, repository_selection: 'selected', permissions: permissionSet },
    '/installation/repositories?per_page=100': { total_count: 1, repositories: [{ full_name: repo }] },
    '/api/devlog-integration': { people: [] },
    ...overrides,
  };
  const fetch = async (target, options) => {
    const url = new URL(target); requests.push({ url, options });
    if (failNetwork) throw new Error('transport exposes ' + env.DISCORD_DEVLOG_WEBHOOK);
    assert.equal(options.redirect, 'error');
    if (url.hostname === 'discord.com') {
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return Response.json({ id: url.pathname.split('/')[3], type: 1, name: 'Webhook', guild_id: '323456789012345678', channel_id: '423456789012345678', token: 'do-not-log' });
    }
    if (url.hostname === 'api.github.com') assert.equal(options.method, 'GET');
    else assert.deepEqual(JSON.parse(options.body), { action: 'people' });
    return Response.json(data[url.pathname + url.search]);
  };
  return { requests, logs, run: () => verifySetup({ env: { ...env, ...config }, fetch, log: message => logs.push(message), now: 1700000000 }) };
}

test('setup verifies exact App installation and destinations without sending messages or exposing credentials', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.app.id, appId); assert.equal(result.webhooks.length, 2);
  assert.deepEqual(result.integration, { status: 'verified', authors: 0 });
  assert.equal(f.requests.filter(request => request.options.method !== 'GET').length, 1);
  const jwt = f.requests[0].options.headers.Authorization.slice(7), [header, claims, signature] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(header + '.' + claims), publicKey, Buffer.from(signature, 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iat: 1699999940, exp: 1700000480, iss: String(appId) });
  for (const secret of [privateKey, jwt, env.DEVLOG_APP_TOKEN, env.DEVLOG_INTEGRATION_TOKEN, env.DISCORD_DEVLOG_WEBHOOK, 'do-not-log']) {
    assert.ok(!f.logs.join('\n').includes(secret));
  }
});

test('wrong App, expanded installations/repositories and missing permission fail closed', async () => {
  const cases = [
    { '/app': { id: 1 } },
    { '/app/installations?per_page=100': [{ id: 12 }, { id: 13 }] },
    { '/installation/repositories?per_page=100': { total_count: 2, repositories: [{ full_name: repo }, { full_name: 'kingslayerrq/other' }] } },
    { ['/repos/' + repo + '/installation']: { id: 12, app_id: appId, account: { login: 'kingslayerrq' }, repository_selection: 'all', permissions: permissionSet } },
    { ['/repos/' + repo + '/installation']: { id: 12, app_id: appId, account: { login: 'kingslayerrq' }, repository_selection: 'selected', permissions: { ...permissionSet, actions: 'read' } } },
  ];
  for (const overrides of cases) await assert.rejects(fixture({ overrides }).run());
});

test('setup refuses non-owner/branch execution before network access', async () => {
  for (const config of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR_ID: '99' }, { GITHUB_REPOSITORY: 'other/repo' }]) {
    const f = fixture({ config }); await assert.rejects(f.run(), /repository owner/); assert.equal(f.requests.length, 0);
  }
});

test('webhook credentials cannot be redirected to untrusted destinations', async () => {
  for (const value of ['https://example.com/api/webhooks/123456789012345678/secret', env.DISCORD_DEVLOG_WEBHOOK + '?query=secret', 'https://discord.com:8443/api/webhooks/123456789012345678/secret']) {
    const f = fixture({ config: { DISCORD_DEVLOG_ALERTS_WEBHOOK: value } });
    await assert.rejects(f.run(), /supported Discord/);
    assert.ok(f.requests.every(request => request.url.hostname === 'api.github.com'));
  }
});

test('missing integration is an explicit opt-in skip and otherwise fails', async () => {
  const config = { DEVLOG_INTEGRATION_TOKEN: '' };
  await assert.rejects(fixture({ config }).run(), /shared token are required/);
  const f = fixture({ config: { ...config, REQUIRE_INTEGRATION: 'false' } });
  assert.equal((await f.run()).integration.status, 'skipped');
  assert.ok(f.logs.some(line => line.includes('readiness is unverified')));
  assert.ok(f.requests.every(request => request.url.hostname !== 'dispatch.example.test'));
  const configured = fixture({ config: { REQUIRE_INTEGRATION: 'false' } });
  assert.equal((await configured.run()).integration.status, 'skipped');
  assert.ok(configured.requests.every(request => request.url.hostname !== 'dispatch.example.test'));
});

test('transport errors do not echo URLs, credentials or arbitrary response details', async () => {
  const f = fixture({ failNetwork: true });
  await assert.rejects(f.run(), error => error.message.includes('GitHub metadata') && !error.message.includes('publish-secret'));
});

test('setup workflow is owner-only main dispatch and tests the entire installation while publishing is disabled', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/setup.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const job = workflow.jobs.verify;
  assert.ok(job.if.includes("refs/heads/main") && job.if.includes("22969898"));
  assert.equal(job.environment, 'devlog-publishing');
  assert.ok(!job.if.includes('DEVLOG_NATIVE_ENABLED'));
  const token = job.steps.find(step => step.uses?.startsWith('actions/create-github-app-token@'));
  assert.equal(token.with.owner, '${{ github.repository_owner }}');
  assert.equal(token.with.repositories, undefined);
  for (const [name, level] of Object.entries(permissionSet)) assert.equal(token.with['permission-' + name.replaceAll('_', '-')], level);
  assert.ok(!job.steps.some(step => step.run?.includes('npm')));
});
