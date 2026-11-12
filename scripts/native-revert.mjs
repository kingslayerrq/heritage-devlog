import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGithub, OWNER_ID, shaPattern } from './native-api.mjs';

const git = (root, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function validateRevertRequest({ env, event, run, repo }) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_ACTOR_ID !== String(OWNER_ID) || event.sender?.id !== OWNER_ID ||
      run.actor?.id !== OWNER_ID || run.triggering_actor?.id !== OWNER_ID ||
      run.event !== 'workflow_dispatch' || run.path !== '.github/workflows/revert.yml' ||
      run.head_branch !== 'main' || run.head_sha !== env.GITHUB_SHA ||
      run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) {
    throw new Error('Only the repository owner may dispatch or rerun this workflow from main.');
  }
  if (!shaPattern.test(event.inputs?.commit || '')) throw new Error('Provide the full lowercase 40-character commit SHA.');
  if (!shaPattern.test(env.GITHUB_SHA || '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')) throw new Error('Invalid workflow identity.');
  return { target: event.inputs.commit, base: env.GITHUB_SHA, branch: 'codex/revert-' + event.inputs.commit.slice(0, 12) + '-' + env.GITHUB_RUN_ID };
}

/** Prepare only in the clean, trusted main checkout. No hooks, builds or reverted code run. */
export function prepareRevertCommit({ root, target, base }) {
  if (![target, base].every(value => typeof value === 'string' && shaPattern.test(value))) throw new Error('Invalid revert revision.');
  if (git(root, 'status', '--porcelain')) throw new Error('The checkout must be clean before preparing a revert.');
  if (git(root, 'rev-parse', 'HEAD') !== base) throw new Error('The checkout does not match the reviewed main revision.');
  try {
    git(root, 'rev-parse', '--verify', target + '^{commit}');
    git(root, 'merge-base', '--is-ancestor', target, base);
  } catch { throw new Error('The target must be a commit already on this main revision.'); }
  const parents = git(root, 'rev-list', '--parents', '-n', '1', target).split(/\s+/);
  if (parents.length !== 2) throw new Error('Root and merge commits require a manual revert; this workflow only handles single-parent commits.');
  try {
    git(root, 'revert', '--no-commit', target);
    let empty = true;
    try { git(root, 'diff', '--cached', '--quiet'); } catch (error) { if (error.status !== 1) throw error; empty = false; }
    if (empty) throw new Error('The revert has no changes; this commit may already be reverted.');
    git(root, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '--no-verify', '-m', 'Revert ' + target + ' for owner review');
    return git(root, 'rev-parse', 'HEAD');
  } catch {
    // The checkout was verified clean before we touched it, so restore only our attempted revert.
    try { git(root, 'revert', '--abort'); } catch { /* No sequencer after a successful --no-commit. */ }
    git(root, 'reset', '--hard', base);
    throw new Error('The revert is empty or conflicts with later changes. No branch was pushed; prepare this revert manually.');
  }
}

export async function createRevertPull({ api, repo, branch, target, base, head, push }) {
  if (!shaPattern.test(head || '') || !shaPattern.test(target || '') || !shaPattern.test(base || '') ||
      !/^codex\/revert-[a-f0-9]{12}-[1-9][0-9]*$/.test(branch || '')) throw new Error('Invalid prepared revert.');
  const main = await api('GET', '/git/ref/heads/main');
  if (main.object?.sha !== base) throw new Error('Main advanced while preparing the revert. Nothing was pushed; rerun from current main.');
  // push is a create-only branch operation; it cannot update main or an existing branch.
  await push(branch, head);
  const pull = await api('POST', '/pulls', {
    title: 'Revert ' + target.slice(0, 12) + ' · owner review required',
    head: branch, base: 'main', draft: true, maintainer_can_modify: false,
    body: [
      'Prepared the inverse of commit ' + target + ' against main ' + base + '.',
      '',
      'This is a DRAFT for the repository owner to review. No merge or deployment was requested.',
      '',
      'Review the complete diff, validate and test the proposed result, then decide whether to merge it manually under the repository protections.',
      'The automation does not bypass required checks. If policy requires a new owner push or check, complete that step before merging.',
      'A merge or deployment has not happened merely because this draft exists.',
    ].join('\n'),
  });
  if (!Number.isSafeInteger(pull.number) || pull.draft !== true || pull.head?.sha !== head ||
      pull.head?.ref !== branch || pull.head?.repo?.full_name !== repo || pull.base?.ref !== 'main') {
    throw new Error('GitHub did not confirm the expected draft PR. Inspect the prepared branch before retrying.');
  }
  return { number: pull.number, url: 'https://github.com/' + repo + '/pull/' + pull.number, branch, head };
}

export async function main() {
  const env = process.env;
  const source = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const { api, repo } = createGithub({ token: env.GITHUB_TOKEN });
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')) throw new Error('Invalid workflow run ID.');
  const run = await api('GET', '/actions/runs/' + env.GITHUB_RUN_ID);
  const request = validateRevertRequest({ env, event: source, run, repo });
  const root = process.cwd();
  const current = await api('GET', '/git/ref/heads/main');
  if (current.object?.sha !== request.base) throw new Error('Main changed after dispatch. Rerun this workflow from current main.');
  const head = prepareRevertCommit({ root, ...request });
  const result = await createRevertPull({ api, repo, ...request, head, push: async (branch, revision) => {
    try {
      // An empty expected value means the remote branch MUST NOT already exist.
      git(root, 'push', '--porcelain', '--force-with-lease=refs/heads/' + branch + ':', 'origin', revision + ':refs/heads/' + branch);
    } catch { throw new Error('The draft branch push was not confirmed. Inspect ' + branch + ' before retrying; no main update was attempted.'); }
  } });
  console.log('Prepared draft PR for owner review: ' + result.url);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    '### Revert prepared for owner review\n\n[Open draft PR](' + result.url + ')\n\nNo automatic merge or deployment was requested.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
