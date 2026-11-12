import test from 'node:test';
import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { OWNER_ID, CHECK_NAME, requirePeople, verifiedActor } from '../scripts/native-api.mjs';
import { policyIssues, safePath, materializeProject, changedPosts } from '../scripts/native-git.mjs';
import { assertMergeCurrent, protectionReady, validateSourceRun, actorForHead, previousDeployment, deploymentIsCurrent, resolvedHead } from '../scripts/native-pipeline.mjs';
import { makeReport, deliverReport, reportRecipients } from '../scripts/report-discord.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40), repo = 'kingslayerrq/heritage-devlog';
const people = [
  { author: 'writer', discord: '123456789012345678', github: 'writer-git', githubId: 123, name: '作者', active: true },
  { author: 'artist', discord: '223456789012345678', name: '美术', active: true },
  { author: 'owner', discord: '323456789012345678', github: 'kingslayerrq', githubId: OWNER_ID, name: 'Owner', active: true },
];
const regular = path => ({ path, mode: '100644', type: 'blob' });
const policy = changes => policyIssues({ changes: changes.map(path => ({ status: 'M', path })), entries: changes.map(regular), actorId: 123, author: people[0] });
test('content paths accepted; code, generated identity and workflow paths blocked', () => {
  assert.equal(policy(['src/content/posts/2026-11-11-test.md', 'public/media/test/image.png']).length, 0);
  for (const path of ['src/content/authors/writer.json', 'public/media/authors/writer.png', '.github/workflows/native.yml', 'package.json', 'src/pages/index.astro']) {
    assert.ok(policy([path]).some(issue => issue.code === 'site-code'));
  }
});
test('owner exemption uses verified numeric ID, not display name or claimed profile', () => {
  assert.equal(policyIssues({ changes: [{ path: 'package.json' }], entries: [regular('package.json')], actorId: OWNER_ID }).length, 0);
  assert.ok(policyIssues({ changes: [{ path: 'package.json' }], entries: [regular('package.json')], actorId: 123, author: { github: 'kingslayerrq' } }).some(issue => issue.code === 'site-code'));
});
test('unlinked or stale branch cannot publish', () => {
  assert.ok(policyIssues({ changes: [], entries: [], actorId: 123 }).some(issue => issue.code === 'account-unlinked'));
  assert.ok(policyIssues({ changes: [], entries: [], actorId: 123, author: people[0], baseIsAncestor: false }).some(issue => issue.code === 'stale-base'));
});
test('symlinks, executable files, traversal and Windows aliases are rejected', () => {
  for (const mode of ['120000', '160000', '100755']) assert.ok(policyIssues({ changes: [{ path: 'public/media/test/a.png' }], entries: [{ ...regular('public/media/test/a.png'), mode }], actorId: 123, author: people[0] }).some(issue => issue.code === 'unsafe-mode'));
  for (const path of ['../outside', 'public/../secret', '/absolute', 'public\\escape', 'public/a:stream', 'public/CON.png', 'public/trailing.']) assert.equal(safePath(path), false, path);
});
test('registry retains Discord-only authors and rejects forged duplicates', () => {
  assert.equal(requirePeople(people).length, 3);
  assert.equal(verifiedActor(people, 123).author, 'writer');
  assert.equal(verifiedActor([{ ...people[0], active: false }], 123), undefined);
  assert.throws(() => requirePeople([...people, people[0]]));
});
test('trusted source run verifies repository, workflow path and original actor', () => {
  const run = { event: 'push', path: '.github/workflows/check.yml', head_repository: { full_name: repo }, repository: { full_name: repo }, head_branch: 'devlog/write', head_sha: head, actor: { id: 123, login: 'writer' }, triggering_actor: { id: OWNER_ID } };
  assert.equal(validateSourceRun(run, repo).actor.id, 123);
  assert.throws(() => validateSourceRun({ ...run, event: 'pull_request' }, repo));
  assert.throws(() => validateSourceRun({ ...run, head_repository: { full_name: 'attacker/fork' } }, repo));
});
test('actor discovery uses authenticated push run rather than commit authors or rerun actor', async () => {
  const actor = await actorForHead(async () => ({ workflow_runs: [
    { event: 'push', path: '.github/workflows/other.yml', head_sha: head, head_branch: 'devlog/a', actor: { id: OWNER_ID } },
    { event: 'push', path: '.github/workflows/check.yml', head_sha: head, head_branch: 'devlog/a', repository: { id: 1 }, head_repository: { id: 1 }, actor: { id: 123, login: 'writer' }, triggering_actor: { id: OWNER_ID } },
  ] }), head, 'devlog/a');
  assert.equal(actor.id, 123);
});
const protection = { required_status_checks: { strict: true, checks: [{ context: CHECK_NAME, app_id: 9 }] }, required_pull_request_reviews: { required_approving_review_count: 0 }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
test('automatic merge requires a strict status check bound to the publishing App', () => {
  assert.equal(protectionReady(protection, 9), true);
  assert.equal(protectionReady(protection, 10), false);
  assert.equal(protectionReady({ ...protection, required_pull_request_reviews: null }, 9), false);
  assert.equal(protectionReady({ ...protection, required_status_checks: { ...protection.required_status_checks, strict: false } }, 9), false);
});
test('changed head or main prevents automatic merge', async () => {
  const context = { repo, pr: 1, head, base };
  const pull = { state: 'open', draft: false, head: { sha: head, repo: { full_name: repo } }, base: { ref: 'main', sha: base } };
  const api = async (_, path) => path === '/pulls/1' ? pull : path === '/git/ref/heads/main' ? { object: { sha: base } } : protection;
  assert.equal((await assertMergeCurrent({ api, context, appId: 9 })).head.sha, head);
  pull.head.sha = 'c'.repeat(40);
  await assert.rejects(assertMergeCurrent({ api, context, appId: 9 }), /changed/);
  pull.head.sha = head;
  await assert.rejects(assertMergeCurrent({ api: async (m, p) => p === '/git/ref/heads/main' ? { object: { sha: 'c'.repeat(40) } } : api(m, p), context, appId: 9 }), /changed/);
});
test('publication baseline ignores failed deployments and current revision', async () => {
  const previous = 'c'.repeat(40);
  const api = async (_, path) => path.startsWith('/deployments?') ? [{ id: 1, sha: head }, { id: 2, sha: base }, { id: 3, sha: previous }] :
    path.includes('/2/') ? [{ state: 'failure' }] : [{ state: 'success' }];
  assert.equal(await previousDeployment(api, head), previous);
});
test('report mentions include submitter and old/new Discord-only authors; owner on policy errors', () => {
  assert.deepEqual(reportRecipients({ people, actorId: 123, authors: ['artist'], owner: true }), people.map(person => person.discord));
  const payload = makeReport({ repo, revision: head, kind: 'policy', people, actorId: 123, actorLogin: 'writer', authors: ['artist'], title: '@everyone <@999999999999999999>', issues: [{ severity: 'error', path: 'package.json', line: 3, message: 'Remove this change', fix: 'Revert and push again' }] });
  assert.deepEqual(payload.allowed_mentions.parse, []);
  assert.deepEqual(payload.allowed_mentions.users, people.map(person => person.discord));
  assert.ok(!payload.content.includes('999999999999999999'));
  assert.ok(payload.embeds[0].fields.some(field => field.name.includes('package.json:3')));
});
test('large reports remain within Discord embed limits', () => {
  const payload = makeReport({ repo, revision: head, kind: 'warning', people, actorId: 123, title: '标'.repeat(300), summary: '文'.repeat(2000),
    issues: Array.from({ length: 100 }, () => ({ severity: 'warning', path: 'p'.repeat(400), line: 123, message: '*'.repeat(2000), fix: '_'.repeat(2000) })) });
  const embed = payload.embeds[0];
  const total = embed.title.length + embed.description.length + (embed.author?.name.length || 0) + embed.footer.text.length + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, String(total)); assert.ok(embed.fields.every(field => field.value.length <= 1024));
});

const webhook = 'https://discord.com/api/webhooks/123456789012345678/token';
function ledger() {
  let record;
  return { get record() { return record; }, integration: async body => {
    if (body.action === 'reserve-report') {
      if (record?.state === 'sent') return record;
      if (record && record.state !== 'failed') return { state: record.state };
      record = { state: 'pending', key: body.key, revision: body.revision }; return { state: 'reserved', reservation: 'f'.repeat(64) };
    }
    record = { ...record, state: body.outcome, messageId: body.messageId }; return record;
  } };
}
const delivery = extra => ({ webhook, repo, kind: 'publish', revision: head, scope: 'post:one', payload: { content: 'test' }, ...extra });
test('confirmed sends are deduplicated across reruns', async () => {
  const state = ledger(); let count = 0;
  const fetch = async url => { count++; assert.equal(url.searchParams.get('wait'), 'true'); return new Response(JSON.stringify({ id: '423456789012345678' }), { status: 200 }); };
  await deliverReport(delivery({ integration: state.integration, fetch }));
  assert.equal((await deliverReport(delivery({ integration: state.integration, fetch }))).duplicate, true);
  assert.equal(count, 1);
});
test('concurrent report attempts share a durable reservation', async () => {
  const state = ledger(); let release, count = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const fetch = async () => { count++; await pending; return new Response(JSON.stringify({ id: '423456789012345678' }), { status: 200 }); };
  const first = deliverReport(delivery({ integration: state.integration, fetch }));
  await assert.rejects(deliverReport(delivery({ integration: state.integration, fetch })), /pending or uncertain/);
  release(); await first; assert.equal(count, 1);
});
test('timeouts, server errors and missing receipts remain uncertain and block retries', async () => {
  for (const fetch of [async () => { throw new Error('timeout'); }, async () => new Response('', { status: 502 }), async () => new Response('{}', { status: 200 })]) {
    const state = ledger();
    await assert.rejects(deliverReport(delivery({ integration: state.integration, fetch })));
    assert.equal(state.record.state, 'uncertain');
    await assert.rejects(deliverReport(delivery({ integration: state.integration, fetch })), /uncertain/);
  }
});
test('provably unsent 4xx responses can be retried without republishing content', async () => {
  const state = ledger();
  await assert.rejects(deliverReport(delivery({ integration: state.integration, fetch: async () => new Response('', { status: 429 }) })));
  assert.equal(state.record.state, 'failed');
  await deliverReport(delivery({ integration: state.integration, fetch: async () => new Response('{"id":"423456789012345678"}', { status: 200 }) }));
  assert.equal(state.record.state, 'sent');
});
test('receipt persistence failure does not lead to an automatic second post', async () => {
  const state = ledger(); let count = 0;
  const integration = async body => { if (body.action === 'complete-report') throw new Error('offline'); return state.integration(body); };
  const fetch = async () => { count++; return new Response('{"id":"423456789012345678"}', { status: 200 }); };
  await assert.rejects(deliverReport(delivery({ integration, fetch })), /REPORT_KEY=/);
  await assert.rejects(deliverReport(delivery({ integration, fetch })), /pending/);
  assert.equal(count, 1);
});
test('malicious webhook endpoints rejected before reservation or network', async () => {
  await assert.rejects(deliverReport(delivery({ webhook: 'https://example.com/secret', integration: async () => { throw new Error('should not reserve'); } })), /Invalid Discord/);
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devlog-native-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const put = (path, value) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), value); };
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  return { dir, git, put, commit };
}
const post = (draft = false, authors = ['writer'], extra = '') => '---\ntitle: 中文日志\ndate: 2026-11-11\ndiscipline: tech\nauthors: [' + authors.join(', ') + ']\ndraft: ' + draft + '\n---\n\nContent.\n' + extra;
test('new posts, published drafts, edits, media changes and removals are classified correctly', t => {
  const f = fixture(t), path = 'src/content/posts/2026-11-11-test.md';
  f.put(path, post(true)); f.put('public/media/test/image.png', 'first'); f.put('package.json', '{}'); const first = f.commit();
  f.put(path, post(false, ['writer', 'artist'], '![image](/media/test/image.png)')); const second = f.commit();
  assert.equal(changedPosts(f.dir, first, second)[0].kind, 'publish');
  f.put('public/media/test/image.png', 'second'); const third = f.commit();
  const media = changedPosts(f.dir, second, third)[0];
  assert.equal(media.kind, 'edit'); assert.deepEqual(media.authors, ['writer', 'artist']);
  f.put(path, post(false, ['writer'], 'Updated')); const fourth = f.commit();
  assert.deepEqual(changedPosts(f.dir, third, fourth)[0].authors, ['writer', 'artist']);
  f.git('rm', path); const fifth = f.commit();
  assert.equal(changedPosts(f.dir, fourth, fifth)[0].kind, 'unpublish');
});
test('content projection keeps trusted site code and overlays only reviewed data', t => {
  const f = fixture(t), path = 'src/content/posts/2026-11-11-test.md';
  f.put(path, post()); f.put('package.json', '{"trusted":true}'); const first = f.commit();
  f.put(path, post(false, ['writer'], 'Changed')); const second = f.commit();
  const target = join(f.dir, 'output');
  materializeProject({ root: f.dir, target, base: first, head: second, actorId: 123 });
  assert.equal(readFileSync(join(target, 'package.json'), 'utf8'), '{"trusted":true}');
  assert.ok(readFileSync(join(target, path), 'utf8').includes('Changed'));
  f.put('package.json', '{"attacker":true}'); const third = f.commit();
  assert.throws(() => materializeProject({ root: f.dir, target: join(f.dir, 'blocked'), base: second, head: third, actorId: 123 }), /policy/);
});
test('workflows separate secrets from candidate builds and pin deployments to event SHA', () => {
  const native = readFileSync(new URL('../.github/workflows/native.yml', import.meta.url), 'utf8');
  const build = native.split('\n  build:')[1].split('\n  finalize:')[0];
  assert.ok(!build.includes('secrets.') && !build.includes('environment:'));
  assert.ok(native.includes('workflow_run:') && !native.includes('pull_request_target:'));
  const deploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.ok(!deploy.includes('github.ref_name'));
  assert.ok(deploy.includes('ref: $' + '{{ github.sha }}'));
});

test('malformed author metadata does not crash reporting before validation', t => {
  const f = fixture(t), path = 'src/content/posts/nested/2026-11-11-test.md';
  f.put(path, post()); const first = f.commit();
  f.put(path, post().replace('authors: [writer]', 'authors: 17')); const second = f.commit();
  assert.deepEqual(changedPosts(f.dir, first, second)[0].authors, ['writer']);
  assert.equal(changedPosts(f.dir, first, second)[0].after.slug, 'nested/2026-11-11-test');
  f.put(path, post().replace('authors: [writer]', 'authors: {writer: true}')); const third = f.commit();
  assert.deepEqual(changedPosts(f.dir, second, third)[0].authors, []);
});
test('percent-encoded media references still generate edit reports', t => {
  const f = fixture(t), path = 'src/content/posts/2026-11-11-test.md', media = 'public/media/test/图片.png';
  f.put(path, post(false, ['writer'], '![](/media/test/%E5%9B%BE%E7%89%87.png)')); f.put(media, 'first'); const first = f.commit();
  f.put(media, 'second'); const second = f.commit();
  assert.equal(changedPosts(f.dir, first, second)[0].kind, 'edit');
});
test('older deployment retries cannot promote over the current main revision', () => {
  assert.equal(deploymentIsCurrent(head, head), true);
  assert.equal(deploymentIsCurrent(head, base), false);
  assert.throws(() => deploymentIsCurrent('', head));
});
test('missing request workflow falls back only to an exact authenticated PushEvent', async () => {
  const actor = await actorForHead(async (_, path) => path.startsWith('/actions/') ? { workflow_runs: [] } : [
    { type: 'PushEvent', payload: { head, ref: 'refs/heads/devlog/test' }, actor: { id: 123, login: 'writer' } },
  ], head, 'devlog/test');
  assert.equal(actor.id, 123);
  const unknown = await actorForHead(async (_, path) => path.startsWith('/actions/') ? { workflow_runs: [] } : [
    { type: 'PushEvent', payload: { head: base, ref: 'refs/heads/devlog/test' }, actor: { id: OWNER_ID } },
  ], head, 'devlog/test');
  assert.equal(unknown.id, 0);
});
test('workflow YAML is valid and native rollout defaults off', () => {
  for (const name of ['check', 'native', 'deploy']) {
    const workflow = yaml.load(readFileSync(new URL('../.github/workflows/' + name + '.yml', import.meta.url), 'utf8'));
    assert.ok(workflow.on && !Array.isArray(workflow.on));
    for (const job of Object.values(workflow.jobs)) assert.ok(Array.isArray(job.steps) && job.steps.length);
    if (name !== 'check') assert.ok(workflow.jobs.prepare.if.includes("DEVLOG_NATIVE_ENABLED == 'true'"));
  }
});

test('malformed Discord receipt IDs are uncertain rather than persisted as confirmed', async () => {
  for (const id of [123456789012345678, ['423456789012345678'], '123456789012345']) {
    const state = ledger();
    await assert.rejects(deliverReport(delivery({ integration: state.integration, fetch: async () => new Response(JSON.stringify({ id }), { status: 200 }) })), /REPORT_KEY=/);
    assert.equal(state.record.state, 'uncertain');
  }
});

test('reconciliation does not reopen an already merged or closed exact head', () => {
  assert.equal(resolvedHead([{ state: 'closed', merged_at: '2026-11-11', head: { sha: head } }], head), true);
  assert.equal(resolvedHead([{ state: 'closed', head: { sha: head } }], head), true);
  assert.equal(resolvedHead([{ state: 'closed', head: { sha: base } }], head), false);
  assert.equal(resolvedHead([{ state: 'open', head: { sha: head } }], head), false);
});


test('scheduled reconciliation token can inspect resolved PRs before dispatching', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/native.yml', import.meta.url), 'utf8'));
  const token = workflow.jobs.reconcile.steps.find(step => step.uses?.startsWith('actions/create-github-app-token@'));
  assert.equal(token.with['permission-pull-requests'], 'read');
  assert.equal(token.with['permission-contents'], 'read');
  assert.equal(token.with['permission-checks'], 'read');
  assert.equal(token.with['permission-actions'], 'write');
});
