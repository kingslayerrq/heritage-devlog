import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { validateRevertRequest, prepareRevertCommit, createRevertPull } from '../scripts/native-revert.mjs';
import { OWNER_ID } from '../scripts/native-api.mjs';

const repo = 'kingslayerrq/heritage-devlog', base = 'a'.repeat(40), target = 'b'.repeat(40), head = 'c'.repeat(40);
const branch = 'codex/revert-' + target.slice(0, 12) + '-123';
function request() {
  return { repo, env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: String(OWNER_ID), GITHUB_SHA: base, GITHUB_RUN_ID: '123' },
    event: { sender: { id: OWNER_ID }, inputs: { commit: target } },
    run: { actor: { id: OWNER_ID }, triggering_actor: { id: OWNER_ID }, event: 'workflow_dispatch', path: '.github/workflows/revert.yml', head_branch: 'main', head_sha: base, repository: { full_name: repo }, head_repository: { full_name: repo } } };
}
test('only the numeric owner may dispatch or rerun from trusted main with a full SHA', () => {
  assert.deepEqual(validateRevertRequest(request()), { target, base, branch });
  for (const alter of [
    value => { value.env.GITHUB_REF = 'refs/heads/untrusted'; },
    value => { value.env.GITHUB_ACTOR_ID = '123'; },
    value => { value.event.sender.id = 123; },
    value => { value.run.triggering_actor.id = 123; },
    value => { value.run.head_sha = target; },
    value => { value.event.inputs.commit = 'HEAD~1'; },
    value => { value.event.inputs.commit = 'bbbbbbb'; },
    value => { value.run.path = '.github/workflows/other.yml'; },
  ]) { const value = request(); alter(value); assert.throws(() => validateRevertRequest(value)); }
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'devlog-revert-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'core.autocrlf', 'false'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const put = (name, value) => writeFileSync(join(root, name), value);
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  put('post.txt', 'original\n'); const first = commit();
  return { root, git, put, commit, first };
}
test('a single-parent ancestor becomes one local revert commit without executing candidate code', t => {
  const f = fixture(t); f.put('post.txt', 'changed\n'); const target = f.commit();
  f.put('other.txt', 'keep\n'); const base = f.commit();
  const head = prepareRevertCommit({ root: f.root, target, base });
  assert.notEqual(head, base);
  assert.equal(f.git('rev-parse', head + '^'), base);
  assert.equal(readFileSync(join(f.root, 'post.txt'), 'utf8'), 'original\n');
  assert.equal(readFileSync(join(f.root, 'other.txt'), 'utf8'), 'keep\n');
  assert.equal(f.git('status', '--porcelain'), '');
});
test('conflicting reverts restore only the previously clean checkout and create no commit', t => {
  const f = fixture(t); f.put('post.txt', 'changed\n'); const target = f.commit();
  f.put('post.txt', 'later incompatible change\n'); const base = f.commit();
  assert.throws(() => prepareRevertCommit({ root: f.root, target, base }), /conflicts/);
  assert.equal(f.git('rev-parse', 'HEAD'), base);
  assert.equal(readFileSync(join(f.root, 'post.txt'), 'utf8'), 'later incompatible change\n');
  assert.equal(f.git('status', '--porcelain'), '');
});
test('empty, dirty, unrelated and merge commits are refused before any remote operation', t => {
  const f = fixture(t); f.put('post.txt', 'changed\n'); const target = f.commit();
  f.git('revert', '--no-edit', target); let base = f.git('rev-parse', 'HEAD');
  assert.throws(() => prepareRevertCommit({ root: f.root, target, base }), /empty|conflicts/);
  assert.equal(f.git('rev-parse', 'HEAD'), base);
  f.put('uncommitted.txt', 'keep me');
  assert.throws(() => prepareRevertCommit({ root: f.root, target, base }), /clean/);
  assert.equal(readFileSync(join(f.root, 'uncommitted.txt'), 'utf8'), 'keep me');
  f.git('add', '.'); f.git('commit', '-m', 'keep local'); base = f.git('rev-parse', 'HEAD');
  f.git('switch', '-c', 'side'); f.put('side.txt', 'side'); const unrelated = f.commit();
  f.git('switch', 'main');
  assert.throws(() => prepareRevertCommit({ root: f.root, target: unrelated, base }), /already on/);
  f.git('merge', '--no-ff', 'side', '-m', 'merge'); const merged = f.git('rev-parse', 'HEAD');
  assert.throws(() => prepareRevertCommit({ root: f.root, target: merged, base: merged }), /merge commits/);
});
test('publication only creates the prepared branch and a draft PR, never updates main or requests merge', async () => {
  const calls = [];
  const result = await createRevertPull({ repo, branch, target, base, head,
    push: async (ref, sha) => calls.push(['push', ref, sha]),
    api: async (method, path, body) => {
      calls.push([method, path, body]);
      if (method === 'GET') return { object: { sha: base } };
      assert.equal(path, '/pulls'); assert.equal(body.draft, true); assert.equal(body.base, 'main');
      return { number: 7, draft: true, head: { sha: head, ref: branch, repo: { full_name: repo } }, base: { ref: 'main' } };
    } });
  assert.equal(result.url, 'https://github.com/' + repo + '/pull/7');
  assert.deepEqual(calls.map(call => call[0]), ['GET', 'push', 'POST']);
  assert.equal(calls[1][1], branch);
});
test('a changed main or failed branch push prevents PR creation', async () => {
  let pushes = 0, posts = 0;
  const api = async (method) => { if (method === 'POST') posts++; return { object: { sha: head } }; };
  await assert.rejects(createRevertPull({ api, repo, branch, target, base, head, push: async () => { pushes++; } }), /Main advanced/);
  assert.equal(pushes, 0); assert.equal(posts, 0);
  await assert.rejects(createRevertPull({ api: async () => ({ object: { sha: base } }), repo, branch, target, base, head,
    push: async () => { throw new Error('existing branch'); } }), /existing branch/);
});
test('workflow is owner-only main dispatch with protected environment and no deploy or merge step', () => {
  const source = readFileSync(new URL('../.github/workflows/revert.yml', import.meta.url), 'utf8');
  assert.ok(source.includes("github.ref == 'refs/heads/main'") && source.includes("github.actor_id == '22969898'"));
  assert.ok(source.includes('environment: devlog-publishing'));
  assert.ok(source.includes('node scripts/native-revert.mjs'));
  assert.ok(!source.includes('git push origin HEAD:main') && !source.includes('deploy.yml') && !source.includes('npm '));
});
