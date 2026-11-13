import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGithub, createIntegration, requirePeople, OWNER_ID, shaPattern } from './native-api.mjs';
import { tree } from './native-git.mjs';
import { compileNotionSnapshot, stableStringify } from './notion-content.mjs';
import { validateSource, validateManifest, verifyImportTree, authorizeImport, gitBytes, hashBytes } from './notion-provenance.mjs';
import { deliverReport, makeReport } from './report-discord.mjs';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const issue = (code, message) => ({ severity: 'error', code, path: '', line: 1, message,
  fix: 'Review the Notion page feedback and GitHub run. Correct the source, then set its status to Ready again.' });
const safeIssues = error => Array.isArray(error.issues) ? error.issues : [issue('notion-import', 'The Notion import could not be completed. No source files were overwritten.')];
export function verifyPreviousManifest(root, base, snapshot) {
  const entries = new Map(tree(root, base).map(entry => [entry.path, entry]));
  validateManifest(snapshot.previousManifest || [], snapshot, { empty: true });
  for (const item of snapshot.previousManifest || []) {
    const entry = entries.get(item.path);
    if (!entry || entry.type !== 'blob' || entry.mode !== '100644' || hashBytes(gitBytes(root, base, item.path)) !== item.sha256) {
      throw Object.assign(new Error('An imported file was changed in Git; automatic overwrite is blocked.'), {
        issues: [{ ...issue('notion-git-conflict', 'This imported file has changed in Git. Reconcile it with the Notion source before importing again.'), path: item.path }],
      });
    }
  }
  if (!(snapshot.previousManifest || []).length && entries.has(snapshot.path)) throw Object.assign(new Error('The destination article already exists.'), {
    issues: [{ ...issue('notion-path-conflict', 'The destination article already exists and is not owned by this Notion page.'), path: snapshot.path }],
  });
}
export function validateCompiled(snapshot, compiled) {
  validateManifest(compiled.manifest, snapshot);
  if (compiled.post?.path !== snapshot.path || typeof compiled.post.content !== 'string' || Buffer.byteLength(compiled.post.content) > 256 * 1024 || !Array.isArray(compiled.assets) || compiled.assets.length > 20) throw new Error('Invalid compiled Notion content.');
  const files = [{ path: compiled.post.path, bytes: Buffer.from(compiled.post.content) }, ...compiled.assets];
  if (files.length !== compiled.manifest.length || new Set(files.map(file => file.path)).size !== files.length) throw new Error('Compiled Notion files do not match the manifest.');
  let total = 0;
  for (const file of files) {
    const entry = compiled.manifest.find(item => item.path === file.path);
    if (!(file.bytes instanceof Uint8Array) || file.bytes.length > 25 * 1024 * 1024 || !entry || hashBytes(file.bytes) !== entry.sha256) throw new Error('Compiled Notion file hash is invalid.');
    total += file.bytes.length;
  }
  if (total > 100 * 1024 * 1024 || compiled.digest !== hashBytes(stableStringify(compiled.manifest))) throw new Error('Compiled Notion manifest digest is invalid.');
  return files;
}
export function importedPublicUrl(source, env = process.env) {
  const site = new URL(env.SITE_URL || 'https://kingslayerrq.github.io');
  if (site.protocol !== 'https:') throw new Error('Public site URL must use HTTPS.');
  return new URL((env.BASE_PATH || '/heritage-devlog').replace(/\/$/, '') + '/posts/' + source.path.slice('src/content/posts/'.length, -3) + '/', site).href;
}
/** Reconcile publication independently of the source's current editing status. */
export async function recoverImport({ source, root, api, repo, integration, fetchRevision, deploymentApi = api, report = async () => {} }) {
  validateSource(source);
  fetchRevision(source.head); fetchRevision(source.base);
  verifyImportTree(root, source);
  const pulls = await api('GET', '/pulls?state=all&base=main&head=' + encodeURIComponent(repo.split('/')[0] + ':' + source.branch) + '&per_page=100');
  const exact = pulls.find(pull => pull.head?.sha === source.head && pull.head?.ref === source.branch && pull.head?.repo?.full_name === repo && pull.base?.ref === 'main');
  if (!exact?.merged_at) {
    if (exact?.state === 'closed') {
      await integration({ action: 'notion-result', id: source.id, head: source.head, outcome: 'failed', message: 'The import pull request was closed without merging.' });
      return { state: 'closed' };
    }
    // Do not treat a missing merge receipt as publication. The regular import/PR path
    // will resume this bound request; no new content or operation is created here.
    return { state: 'pending' };
  }
  const merged = exact.merge_commit_sha;
  if (!shaPattern.test(merged || '')) throw new Error('Invalid merged Notion receipt.');
  fetchRevision(merged);
  verifyImportTree(root, source, { revision: merged });
  await integration({ action: 'notion-result', id: source.id, head: source.head, outcome: 'merged', revision: merged });
  // A later site's successful deployment can include this import even if its own
  // deployment was superseded. Prove both ancestry and all reserved file bytes.
  for (let page = 1; page <= 10; page++) {
    const deployments = await deploymentApi('GET', '/deployments?environment=github-pages&per_page=100&page=' + page);
    for (const deployment of deployments) {
      if (!shaPattern.test(deployment.sha || '')) continue;
      const statuses = await deploymentApi('GET', '/deployments/' + deployment.id + '/statuses?per_page=100');
      if (!statuses.some(status => status.state === 'success')) continue;
      fetchRevision(deployment.sha);
      try {
        git(root, 'merge-base', '--is-ancestor', merged, deployment.sha);
        verifyImportTree(root, source, { revision: deployment.sha, exactDiff: false });
      } catch { continue; }
      await authorizeImport({ integration, root, branch: source.branch, head: source.head, phase: 'deploy' });
      await integration({ action: 'notion-result', id: source.id, head: source.head, outcome: 'published', revision: deployment.sha,
        // Private entries are confirmed as deployed-but-hidden and carry no public address.
        ...(source.visibility === 'private' ? {} : { url: importedPublicUrl(source) }) });
      return { state: 'published', revision: deployment.sha };
    }
    if (deployments.length < 100) break;
  }
  await report(source);
  return { state: 'awaiting-deployment' };
}
export async function importNext({ root = process.cwd(), github = createGithub(), integration = createIntegration(),
  compile = compileNotionSnapshot, fetchRevision = sha => git(root, 'fetch', '--no-tags', 'origin', sha), report } = {}) {
  const { api, repo } = github;
  const deploymentApi = process.env.GITHUB_TOKEN ? createGithub({ token: process.env.GITHUB_TOKEN, repo }).api : api;
  let people = [];
  const reportSource = async (snapshot, kind, issues, head) => {
    if (report) return report({ snapshot, kind, issues, head, people });
    const revision = head || snapshot.sourceDigest.slice(0, 40);
    const actor = people.find(person => person.author === snapshot.actorAuthor);
    const payload = makeReport({ kind, people, repo, revision, actorId: 0, actorAuthor: snapshot.actorAuthor, actorLogin: actor?.name,
      authors: snapshot.metadata?.authors || snapshot.authors || [], sourceUrl: snapshot.sourceUrl, sourceOnly: !head,
      runId: Number(process.env.GITHUB_RUN_ID), title: snapshot.metadata?.title, issues });
    await deliverReport({ integration, webhook: process.env.DISCORD_DEVLOG_ALERTS_WEBHOOK, repo, kind, revision, scope: 'notion:' + snapshot.id, payload });
    mkdirSync(resolve(root, '.native'), { recursive: true });
    writeFileSync(resolve(root, '.native/reported.json'), JSON.stringify({ head: process.env.GITHUB_SHA || revision, kind }));
  };
  let next = await integration({ action: 'notion-next' });
  if (next.recovery?.length) {
    if (!Array.isArray(next.recovery) || next.recovery.length > 10) throw new Error('Invalid Notion recovery batch.');
    for (const source of next.recovery) {
      try { await recoverImport({ source, root, api, repo, integration, fetchRevision, deploymentApi }); }
      catch (error) {
        people = requirePeople((await integration({ action: 'people' })).people);
        await reportSource(source, 'deployment', safeIssues(error), source.head);
        throw error;
      }
    }
    // Recovery is separately throttled server-side. Continue ordinary imports in
    // this run so an awaiting deployment cannot starve other Ready pages.
    next = await integration({ action: 'notion-next' });
    if (next.recovery?.length) return { state: 'recovering' };
  }
  people = requirePeople(next.people);
  for (const problem of next.problems || []) {
    if (!/^[a-f0-9]{64}$/.test(problem.id || '') || !/^[a-f0-9]{64}$/.test(problem.sourceDigest || '') || !Array.isArray(problem.issues)) throw new Error('Invalid Notion problem report.');
    await reportSource(problem, 'validation', problem.issues);
    await integration({ action: 'notion-result', id: problem.id, outcome: 'failed', message: 'Notion source validation failed. See the Discord report for details.' });
  }
  const snapshot = next.submission;
  if (!snapshot) return { state: 'idle' };
  let head, branchMayExist = false;
  try {
    validateSource(snapshot, { bound: false });
    const author = people.find(person => person.author === snapshot.actorAuthor && person.active);
    if (!author) throw new Error('Notion submitter is not eligible.');
    const compiled = await compile(snapshot);
    const files = validateCompiled(snapshot, compiled);
    const branch = 'notion/' + snapshot.id, refPath = '/git/ref/heads/' + encodeURIComponent(branch);
    const main = await api('GET', '/git/ref/heads/main');
    if (!shaPattern.test(main.object?.sha || '')) throw new Error('Invalid main revision.');
    let existing;
    try { existing = await api('GET', refPath); } catch (error) { if (error.status !== 404) throw error; }
    let base = main.object.sha;
    if (existing) {
      branchMayExist = true; head = existing.object?.sha;
      if (!shaPattern.test(head || '')) throw new Error('Invalid existing import head.');
      fetchRevision(head);
      const commit = await api('GET', '/git/commits/' + head);
      if (commit.parents?.length !== 1 || !shaPattern.test(commit.parents[0].sha || '')) throw new Error('Existing import commit has invalid ancestry.');
      base = commit.parents[0].sha;
      fetchRevision(base);
      verifyImportTree(root, { ...snapshot, branch, head, base, manifest: compiled.manifest });
    } else {
      fetchRevision(base);
      verifyPreviousManifest(root, base, snapshot);
      if (snapshot.previousManifest?.length && stableStringify(snapshot.previousManifest.slice().sort((a, b) => a.path.localeCompare(b.path))) === stableStringify(compiled.manifest)) {
        await integration({ action: 'notion-result', id: snapshot.id, outcome: 'unchanged', manifest: compiled.manifest });
        return { state: 'unchanged' };
      }
      const baseEntries = new Map(tree(root, base).map(entry => [entry.path, entry]));
      for (const file of files) if (file.path !== snapshot.path && baseEntries.has(file.path) && hashBytes(gitBytes(root, base, file.path)) !== hashBytes(file.bytes)) throw new Error('A content-addressed asset path has conflicting content.');
      const commit = await api('GET', '/git/commits/' + base);
      if (!shaPattern.test(commit.tree?.sha || '')) throw new Error('Invalid base tree.');
      const entries = [];
      for (const file of files) {
        const blob = await api('POST', '/git/blobs', { encoding: 'base64', content: Buffer.from(file.bytes).toString('base64') });
        if (!shaPattern.test(blob.sha || '')) throw new Error('Invalid uploaded Git blob.');
        entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const createdTree = await api('POST', '/git/trees', { base_tree: commit.tree.sha, tree: entries });
      if (!shaPattern.test(createdTree.sha || '')) throw new Error('Invalid created Git tree.');
      const created = await api('POST', '/git/commits', { message: 'Import Notion devlog ' + snapshot.pageId, tree: createdTree.sha, parents: [base] });
      if (!shaPattern.test(created.sha || '')) throw new Error('Invalid created Git commit.');
      head = created.sha;
      branchMayExist = true;
      try { await api('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: head }); }
      catch (error) {
        // A lost create response is recoverable only by reading the exact deterministic ref.
        const found = await api('GET', refPath);
        if (found.object?.sha !== head) throw error;
      }
      fetchRevision(head);
      verifyImportTree(root, { ...snapshot, branch, head, base, manifest: compiled.manifest });
    }
    await integration({ action: 'notion-bind', id: snapshot.id, head, base, manifest: compiled.manifest, digest: compiled.digest });
    const pulls = await api('GET', '/pulls?state=all&base=main&head=' + encodeURIComponent(repo.split('/')[0] + ':' + branch) + '&per_page=100');
    const resolved = pulls.find(pull => pull.state === 'closed' && pull.head?.sha === head);
    if (resolved) {
      if (resolved.merged_at) await recoverImport({ source: { ...snapshot, branch, head, base, manifest: compiled.manifest }, root, api, repo, integration, fetchRevision, deploymentApi });
      if (!resolved.merged_at) await integration({ action: 'notion-result', id: snapshot.id, head, outcome: 'failed', message: 'The import pull request was closed without publication. Set Ready again after resolving the review.' });
      return { state: resolved.merged_at ? 'awaiting-deployment' : 'closed', head, branch };
    }
    if (base !== main.object.sha) {
      await integration({ action: 'notion-result', id: snapshot.id, head, outcome: 'failed', message: 'Main advanced before this import was reviewed. Set the page to Ready again to generate a fresh import.' });
      await reportSource(snapshot, 'validation', [issue('notion-stale-base', 'Main advanced before this import could be reviewed. Set the page to Ready again.')], head);
      return { state: 'stale', head, branch };
    }
    if (compiled.warnings?.length) await reportSource(snapshot, 'warning', compiled.warnings, head);
    // Only the trusted importer dispatches reserved branches, after durable provenance binding.
    await api('POST', '/actions/workflows/native.yml/dispatches', { ref: 'main', inputs: { branch } });
    return { state: 'requested', head, branch };
  } catch (error) {
    // Never cancel a reservation after an uncertain ref/bind/dispatch response. A later poll
    // resumes the same branch and exact head; it must not mint a second publication request.
    if (!branchMayExist) await integration({ action: 'notion-result', id: snapshot.id, outcome: 'failed', message: 'Notion import failed before a publishing branch was created. Review the Discord report and retry from Notion.' });
    await reportSource(snapshot, branchMayExist ? 'deployment' : 'validation', safeIssues(error), head);
    throw error;
  }
}
export function validateImportInvocation(env, event) {
  if (env.GITHUB_REF !== 'refs/heads/main' || !['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Notion imports run only from trusted main.');
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && Number(event.sender?.id) !== OWNER_ID) throw new Error('Only the repository owner may request a manual Notion import.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    validateImportInvocation(process.env, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
    const result = await importNext(); console.log('Notion import: ' + result.state);
  } catch { console.error('Notion import failed. Review the redacted Discord report and reconcile any pending import before retrying.'); process.exitCode = 1; }
}
