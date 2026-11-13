import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { compileNotionSnapshot } from '../scripts/notion-content.mjs';
import { importNext, recoverImport, validateCompiled, validateImportInvocation, verifyPreviousManifest } from '../scripts/notion-pipeline.mjs';
import { validateSource, verifyImportTree, authorizeImport } from '../scripts/notion-provenance.mjs';
import { makeReport, reportRecipients } from '../scripts/report-discord.mjs';
import { policyIssues } from '../scripts/native-git.mjs';
import { OWNER_ID } from '../scripts/native-api.mjs';

const repo = 'kingslayerrq/heritage-devlog';
const people = [{ author: 'discord-writer', discord: '123456789012345678', name: 'Discord author', active: true }];
const snapshot = () => ({ id: 'a'.repeat(64), pageId: 'b'.repeat(32), entryId: 'notion-' + 'b'.repeat(32),
  sourceDigest: 'c'.repeat(64), actorAuthor: people[0].author, sourceUrl: 'https://www.notion.so/' + 'b'.repeat(32),
  path: 'src/content/posts/2026-11-11-notion-example-bbbbbbbb.md', previousManifest: [],
  metadata: { title: 'Notion entry', date: '2026-11-11', discipline: 'tech', authors: [people[0].author], summary: 'First import', tags: ['pipeline'] },
  blocks: [{ id: 'd'.repeat(32), type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'A native validated article.' } }] } }],
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'devlog-notion-pipeline-'));
  t.after(() => { if (root.startsWith(join(tmpdir(), 'devlog-notion-pipeline-'))) rmSync(root, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture App'); git('config', 'user.email', 'app@example.invalid');
  git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', '/dev/null');
  const put = (path, bytes) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), bytes); };
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  put('trusted.txt', 'Trusted site'); const base = commit();
  return { root, git, put, commit, base };
}
function harness(f, source = snapshot()) {
  const calls = [], reports = [], results = [], bindings = [];
  let bound, lostRef = false, lostBind = false, main = f.base, closed = false;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/git/ref/heads/main') return { object: { sha: main } };
    if (path.startsWith('/git/ref/heads/')) {
      try { return { object: { sha: f.git('rev-parse', '--verify', 'refs/heads/' + decodeURIComponent(path.slice('/git/ref/heads/'.length))) } }; }
      catch { throw Object.assign(new Error('Not found'), { status: 404 }); }
    }
    if (path.startsWith('/git/commits/')) {
      const sha = path.slice('/git/commits/'.length);
      return { tree: { sha: f.git('rev-parse', sha + '^{tree}') }, parents: f.git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1).map(sha => ({ sha })) };
    }
    if (path === '/git/blobs') {
      const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.root, input: Buffer.from(body.content, 'base64'), encoding: 'utf8' }).trim();
      return { sha };
    }
    if (path === '/git/trees') {
      const env = { ...process.env, GIT_INDEX_FILE: join(f.root, '.git', 'import-index') };
      const indexed = (...args) => execFileSync('git', args, { cwd: f.root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      indexed('read-tree', body.base_tree);
      for (const entry of body.tree) indexed('update-index', '--add', '--cacheinfo', entry.mode + ',' + entry.sha + ',' + entry.path);
      return { sha: indexed('write-tree') };
    }
    if (path === '/git/commits') return { sha: execFileSync('git', ['commit-tree', body.tree, '-p', body.parents[0]], { cwd: f.root, encoding: 'utf8', input: body.message }).trim() };
    if (path === '/git/refs') {
      assert.equal(method, 'POST'); f.git('update-ref', body.ref, body.sha);
      if (lostRef) { lostRef = false; throw new Error('Lost create response'); }
      return { object: { sha: body.sha } };
    }
    if (path.startsWith('/pulls?')) return closed ? [{ state: 'closed', head: { sha: bound.head }, merged_at: '2026-11-11' }] : [];
    if (path === '/actions/workflows/native.yml/dispatches') {
      assert.ok(bound, 'dispatch must follow durable binding'); return null;
    }
    throw new Error('Unexpected API ' + method + ' ' + path);
  };
  const integration = async body => {
    if (body.action === 'notion-next') return { submission: source, people };
    if (body.action === 'notion-bind') {
      bindings.push(body); bound = body;
      if (lostBind) { lostBind = false; throw new Error('Lost bind response'); }
      return {};
    }
    if (body.action === 'notion-result') { results.push(body); return {}; }
    throw new Error('Unexpected integration ' + body.action);
  };
  return { calls, reports, results, bindings, source, api, integration,
    get bound() { return bound; }, set lostRef(value) { lostRef = value; }, set lostBind(value) { lostBind = value; },
    set main(value) { main = value; }, set closed(value) { closed = value; },
    run: (extra = {}) => importNext({ root: f.root, github: { api, repo }, integration, fetchRevision: () => {}, report: value => reports.push(value), ...extra }),
  };
}

test('imports compiled data under the App identity and binds before dispatch; duplicate poll reuses exact head', async t => {
  const f = fixture(t), h = harness(f);
  const first = await h.run();
  assert.equal(first.state, 'requested');
  assert.equal(first.branch, 'notion/' + h.source.id);
  const before = h.calls.filter(call => call.path === '/git/commits' && call.method === 'POST').length;
  assert.equal((await h.run()).head, first.head);
  assert.equal(h.calls.filter(call => call.path === '/git/commits' && call.method === 'POST').length, before);
  assert.equal(h.bindings.length, 2);
  assert.ok(!h.calls.some(call => call.method === 'PATCH'));
  const commit = h.calls.find(call => call.path === '/git/commits' && call.method === 'POST').body;
  assert.equal(commit.author, undefined); assert.equal(commit.committer, undefined);
  verifyImportTree(f.root, { ...h.source, ...h.bound, branch: first.branch });
});

test('lost branch-create receipt reconciles exact ref and a lost bind resumes without second commit', async t => {
  const f = fixture(t), h = harness(f); h.lostRef = true; h.lostBind = true;
  await assert.rejects(h.run(), /Lost bind/);
  assert.equal(h.results.length, 0, 'ambiguous bound operation must remain reserved');
  const head = h.bound.head;
  assert.equal((await h.run()).head, head);
  assert.equal(h.calls.filter(call => call.path === '/git/commits' && call.method === 'POST').length, 1);
});

test('manual Git changes to a previously imported article stop import without overwriting', async t => {
  const f = fixture(t), source = snapshot(), compiled = await compileNotionSnapshot(source);
  f.put(source.path, compiled.post.content); const published = f.commit();
  source.previousManifest = compiled.manifest;
  f.put(source.path, compiled.post.content + '\nA manual correction.\n'); const edited = f.commit();
  const h = harness(f, source); h.main = edited;
  await assert.rejects(h.run(), /changed in Git/);
  assert.equal(h.results[0].outcome, 'failed');
  assert.ok(h.reports[0].issues.some(issue => issue.code === 'notion-git-conflict'));
  assert.ok(!h.calls.some(call => call.path === '/git/blobs'));
  assert.doesNotThrow(() => verifyPreviousManifest(f.root, published, source));
});

test('unchanged content ends the request without a commit, dispatch or success report', async t => {
  const f = fixture(t), source = snapshot(), compiled = await compileNotionSnapshot(source);
  f.put(source.path, compiled.post.content); const published = f.commit(); source.previousManifest = compiled.manifest;
  const h = harness(f, source); h.main = published;
  assert.equal((await h.run()).state, 'unchanged');
  assert.equal(h.results[0].outcome, 'unchanged');
  assert.equal(h.reports.length, 0);
  assert.ok(!h.calls.some(call => call.method === 'POST'));
});

test('merged import waits for deployment instead of reposting or dispatching more review', async t => {
  const f = fixture(t), h = harness(f); await h.run(); h.closed = true;
  const count = h.calls.filter(call => call.path.includes('/dispatches')).length;
  assert.equal((await h.run()).state, 'awaiting-deployment');
  assert.equal(h.calls.filter(call => call.path.includes('/dispatches')).length, count);
});

test('bound provenance requires exact identity, regular files, hashes, complete diff and parent', async t => {
  const f = fixture(t), h = harness(f), first = await h.run();
  const source = { ...h.source, ...h.bound, branch: first.branch };
  assert.throws(() => validateSource(source, { id: 'f'.repeat(64) }), /does not match/);
  assert.throws(() => validateSource({ ...source, branch: 'notion/forged' }), /bound/);
  assert.throws(() => validateSource({ ...source, manifest: [...source.manifest, { path: 'package.json', sha256: 'e'.repeat(64) }] }), /path or hash/);
  assert.throws(() => verifyImportTree(f.root, { ...source, manifest: [{ path: source.path, sha256: 'e'.repeat(64) }] }), /manifest/);
  f.git('switch', first.branch); f.put('package.json', '{}'); const extra = f.commit();
  assert.throws(() => verifyImportTree(f.root, { ...source, head: extra }), /unreserved/);
  f.git('reset', '--hard', first.head); f.git('update-index', '--chmod=+x', source.path); f.git('commit', '-m', 'executable content');
  assert.throws(() => verifyImportTree(f.root, { ...source, head: f.git('rev-parse', 'HEAD') }), /manifest/);
});

test('Notion authorization supports Discord-only members without granting owner policy bypass', async t => {
  const f = fixture(t), h = harness(f), first = await h.run();
  const source = { ...h.source, ...h.bound, branch: first.branch };
  const calls = [];
  const integration = async body => { calls.push(body); return { source, people }; };
  const auth = await authorizeImport({ integration, root: f.root, branch: source.branch, head: source.head, base: source.base });
  assert.equal(auth.actor.id, 0); assert.equal(auth.actorAuthor, people[0].author);
  assert.equal(calls[0].phase, 'review');
  assert.ok(policyIssues({ actorId: auth.actor.id, author: auth.author, changes: [{ path: 'package.json' }], entries: [] }).some(issue => issue.code === 'site-code'));
  await authorizeImport({ integration, root: f.root, branch: source.branch, head: source.head, phase: 'deploy' });
  assert.equal(calls[1].phase, 'deploy');
  await assert.rejects(authorizeImport({ integration: async () => ({ source, people: [{ ...people[0], active: false }] }), root: f.root, branch: source.branch, head: source.head }), /access/);
  await assert.rejects(authorizeImport({ integration, root: f.root, branch: source.branch, head: 'f'.repeat(40) }), /does not match/);
  await assert.rejects(authorizeImport({ integration: async () => { throw new Error('Source edited during review'); }, root: f.root, branch: source.branch, head: source.head }), /Source edited/);
});

test('compile validation rejects injected files and mismatched content before any Git mutation', async t => {
  const f = fixture(t), h = harness(f), compiled = await compileNotionSnapshot(h.source);
  assert.throws(() => validateCompiled(h.source, { ...compiled, post: { ...compiled.post, content: 'tampered' } }), /hash/);
  await assert.rejects(h.run({ compile: async () => ({ ...compiled, manifest: [{ path: 'package.json', sha256: 'e'.repeat(64) }] }) }), /path or hash/);
  assert.equal(h.results[0].outcome, 'failed');
  assert.equal(h.calls.length, 0);
});

test('Notion validation reports mention the verified Discord actor without a GitHub link', () => {
  assert.deepEqual(reportRecipients({ people, actorId: 0, actorAuthor: people[0].author }), [people[0].discord]);
  const source = snapshot();
  const report = makeReport({ repo, kind: 'validation', people, actorId: 0, actorAuthor: source.actorAuthor,
    sourceUrl: source.sourceUrl, sourceOnly: true, revision: source.sourceDigest.slice(0, 40), issues: [{ severity: 'error', message: 'Fix content', sourceUrl: source.sourceUrl + '#' + 'd'.repeat(32), fix: 'Long diagnostic '.repeat(30) }] });
  assert.deepEqual(report.allowed_mentions.users, [people[0].discord]);
  assert.ok(!JSON.stringify(report).includes('/commit/'));
  assert.ok(report.embeds[0].fields.some(field => field.value.includes('[打开 Notion 内容块](' + source.sourceUrl + '#' + 'd'.repeat(32) + ')')));
  assert.throws(() => makeReport({ repo, kind: 'validation', revision: 'f'.repeat(40), sourceUrl: 'https://evil.example/secret' }), /source link/);
});

test('Notion workflow stays on trusted main, uses protected secrets and explicitly excludes branch wakeups', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/notion.yml', import.meta.url), 'utf8'));
  assert.match(workflow.jobs.import.if, /DEVLOG_NOTION_ENABLED == 'true'/);
  assert.equal(workflow.jobs.import.environment, 'devlog-publishing');
  const checkout = workflow.jobs.import.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, 'main'); assert.equal(checkout.with['persist-credentials'], false);
  assert.ok(!JSON.stringify(workflow).includes('NOTION_TOKEN'));
  const check = yaml.load(readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8'));
  assert.ok(check.on.push['branches-ignore'].includes('notion/**'));
  assert.doesNotThrow(() => validateImportInvocation({ GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' }, { sender: { id: OWNER_ID } }));
  assert.throws(() => validateImportInvocation({ GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' }, { sender: { id: 123 } }), /owner/);
  assert.throws(() => validateImportInvocation({ GITHUB_REF: 'refs/heads/attacker', GITHUB_EVENT_NAME: 'schedule' }, {}), /trusted main/);
});


test('a later successful Pages deployment completes a superseded Notion merge without source reread or duplicate report', async t => {
  const f = fixture(t), h = harness(f), first = await h.run();
  const source = { ...h.source, ...h.bound, branch: first.branch };
  f.git('merge', '--squash', first.head); const merged = f.commit();
  f.put('trusted.txt', 'Later reviewed site update'); const later = f.commit();
  const actions = [], reported = [];
  const api = async (_, path) => {
    if (path.startsWith('/pulls?')) return [{ state: 'closed', merged_at: '2026-11-11', merge_commit_sha: merged,
      head: { sha: source.head, ref: source.branch, repo: { full_name: repo } }, base: { ref: 'main' } }];
    if (path.startsWith('/deployments?')) return [{ id: 1, sha: later }];
    if (path.startsWith('/deployments/1/')) return [{ state: 'success' }];
    throw new Error('Unexpected recovery API ' + path);
  };
  const integration = async body => {
    actions.push(body);
    if (body.action === 'notion-authorize') { assert.equal(body.phase, 'deploy'); return { source, people }; }
    return {};
  };
  const result = await recoverImport({ source, root: f.root, api, repo, integration, fetchRevision: () => {}, report: value => reported.push(value) });
  assert.equal(result.state, 'published'); assert.equal(result.revision, later);
  assert.deepEqual(actions.filter(action => action.action === 'notion-result').map(action => action.outcome), ['merged', 'published']);
  assert.equal(actions.at(-1).head, first.head);
  assert.equal(actions.at(-1).url, 'https://kingslayerrq.github.io/heritage-devlog/posts/' + source.path.slice('src/content/posts/'.length, -3) + '/');
  assert.equal(reported.length, 0);
  // A private entry is confirmed by the same deployment proof, but records no public address.
  const hidden = { ...source, visibility: 'private' };
  const privateResult = await recoverImport({ source: hidden, root: f.root, api, repo, integration: async body => { actions.push(body); return body.action === 'notion-authorize' ? { source: hidden, people } : {}; }, fetchRevision: () => {} });
  assert.equal(privateResult.state, 'published');
  assert.deepEqual([actions.at(-1).outcome, 'url' in actions.at(-1)], ['published', false]);
  await assert.rejects(recoverImport({ source: { ...source, visibility: 'internal' }, root: f.root, api, repo, integration, fetchRevision: () => {} }), /Invalid trusted Notion source/);
});

test('a failed deployment or a changed deployed article cannot be mistaken for confirmed publication', async t => {
  const f = fixture(t), h = harness(f), first = await h.run();
  const source = { ...h.source, ...h.bound, branch: first.branch };
  f.git('merge', '--squash', first.head); const merged = f.commit();
  f.put(source.path, 'Unexpected later Git edit'); const edited = f.commit();
  for (const status of ['failure', 'success']) {
    const outcomes = [];
    const api = async (_, path) => {
      if (path.startsWith('/pulls?')) return [{ state: 'closed', merged_at: '2026-11-11', merge_commit_sha: merged,
        head: { sha: source.head, ref: source.branch, repo: { full_name: repo } }, base: { ref: 'main' } }];
      if (path.startsWith('/deployments?')) return [{ id: 1, sha: status === 'failure' ? merged : edited }];
      if (path.startsWith('/deployments/1/')) return [{ state: status }];
      throw new Error('Unexpected recovery API ' + path);
    };
    const result = await recoverImport({ source, root: f.root, api, repo,
      integration: async body => { outcomes.push(body); return {}; }, fetchRevision: () => {} });
    assert.equal(result.state, 'awaiting-deployment');
    assert.deepEqual(outcomes.map(body => body.outcome), ['merged']);
  }
});

test('recovery cannot attribute a foreign or different-head pull request to the reserved import', async t => {
  const f = fixture(t), h = harness(f), first = await h.run();
  const source = { ...h.source, ...h.bound, branch: first.branch };
  const integration = async () => { throw new Error('No state mutation expected'); };
  for (const head of [{ sha: source.head, ref: source.branch, repo: { full_name: 'attacker/fork' } }, { sha: 'f'.repeat(40), ref: source.branch, repo: { full_name: repo } }]) {
    const result = await recoverImport({ source, root: f.root, repo, integration, fetchRevision: () => {}, api: async () => [
      { state: 'closed', merged_at: '2026-11-11', head, base: { ref: 'main' }, merge_commit_sha: source.head },
    ] });
    assert.equal(result.state, 'pending');
  }
});


test('recovery failures notify the verified source author and leave delivery state pending', async t => {
  const f = fixture(t), h = harness(f), first = await h.run();
  const source = { ...h.source, ...h.bound, branch: first.branch };
  const reports = [], actions = [];
  const integration = async body => {
    actions.push(body);
    if (body.action === 'notion-next') return { recovery: [source], people: [], submission: null };
    if (body.action === 'people') return { people };
    throw new Error('No publication state change expected');
  };
  await assert.rejects(importNext({ root: f.root, github: { repo, api: async () => { throw new Error('GitHub unavailable'); } }, integration,
    fetchRevision: () => {}, report: entry => reports.push(entry) }), /unavailable/);
  assert.equal(reports[0].snapshot.actorAuthor, people[0].author);
  assert.equal(reports[0].kind, 'deployment');
  assert.deepEqual(reports[0].people, people);
  assert.ok(!actions.some(body => body.action === 'notion-result'));
});
