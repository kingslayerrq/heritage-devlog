import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGithub, createIntegration, requirePeople, verifiedActor, OWNER_ID, CHECK_NAME, shaPattern } from './native-api.mjs';
import { inspectCandidate, materializeProject, changedPosts, authorIds, safePath } from './native-git.mjs';
import { validateContent } from './content-policy.mjs';
import { syncAuthorProfiles } from './content-profiles.mjs';
import { deliverReport, makeReport } from './report-discord.mjs';

const root = process.cwd();
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, data) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + '\n'); };
const output = (name, value) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n'); };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const event = () => json(process.env.GITHUB_EVENT_PATH);
const issue = (code, message, fix) => ({ severity: 'error', code, path: '', line: 1, message, fix });
const fetchRevision = sha => { if (!shaPattern.test(sha || '')) throw new Error('Invalid commit.'); git('fetch', '--no-tags', 'origin', sha); };
export async function actorForHead(api, head, branch) {
  const result = await api('GET', '/actions/runs?event=push&head_sha=' + head + '&per_page=100');
  const run = result.workflow_runs?.find(run => run.event === 'push' && run.head_sha === head && run.head_branch === branch &&
    run.path === '.github/workflows/check.yml' && Number.isSafeInteger(run.repository?.id) && run.head_repository?.id === run.repository.id && Number.isSafeInteger(run.actor?.id));
  if (run) return { id: run.actor.id, login: run.actor.login };
  // Repository Events sometimes retain a push even when its workflow was removed.
  // Only the exact authenticated event head/ref counts; commit author fields never do.
  const events = await api('GET', '/events?per_page=100');
  const push = events.find(item => item.type === 'PushEvent' && item.payload?.head === head &&
    item.payload?.ref === 'refs/heads/' + branch && Number.isSafeInteger(Number(item.actor?.id)));
  return push ? { id: Number(push.actor.id), login: push.actor.login } : { id: 0, login: '未识别的提交者' };
}
export function validateSourceRun(run, repo) {
  if (run.event !== 'push' || run.path !== '.github/workflows/check.yml' || run.head_repository?.full_name !== repo ||
    run.repository?.full_name !== repo || run.head_branch === 'main' || !shaPattern.test(run.head_sha || '') ||
    !Number.isSafeInteger(run.actor?.id)) throw new Error('The publishing request is not a repository branch push.');
  return { branch: run.head_branch, head: run.head_sha, actor: { id: run.actor.id, login: run.actor.login } };
}
export function protectionReady(protection, appId) {
  return protection?.required_status_checks?.strict === true &&
    protection.required_status_checks.checks?.some(check => check.context === CHECK_NAME && Number(check.app_id) === Number(appId)) &&
    protection.required_pull_request_reviews !== null && typeof protection.required_pull_request_reviews === 'object' &&
    !protection.allow_force_pushes?.enabled && !protection.allow_deletions?.enabled &&
    !(protection.required_pull_request_reviews.bypass_pull_request_allowances?.apps || []).some(app => Number(app.id) === Number(appId));
}
export async function assertMergeCurrent({ api, context, appId }) {
  const pull = await api('GET', '/pulls/' + context.pr);
  const main = await api('GET', '/git/ref/heads/main');
  if (pull.state !== 'open' || pull.draft || pull.head.sha !== context.head || pull.base.ref !== 'main' ||
    pull.head.repo?.full_name !== context.repo || main.object.sha !== context.base || pull.base.sha !== context.base) {
    throw new Error('The pull request or main branch changed after review; refresh the branch and rerun validation.');
  }
  const protection = await api('GET', '/branches/main/protection');
  if (!protectionReady(protection, appId)) throw new Error('Main must require pull requests and the strict App-scoped Devlog content check before automatic merging.');
  return pull;
}
async function send(context, kind, issues = [], extra = {}) {
  const integration = createIntegration();
  const payload = makeReport({ ...context, revision: context.head, actorId: context.actor.id, actorLogin: context.actor.login, kind, issues,
    authors: context.authors || [], ...extra });
  const delivered = await deliverReport({ integration, webhook: ['publish', 'edit'].includes(kind) ? process.env.DISCORD_DEVLOG_WEBHOOK : process.env.DISCORD_DEVLOG_ALERTS_WEBHOOK,
    repo: context.repo, kind, revision: context.head, scope: extra.scope || 'pr:' + context.pr, payload });
  save('.native/reported.json', { kind, head: context.head });
  return delivered;
}
async function check(api, context, conclusion, issues = []) {
  const annotations = issues.filter(item => safePath(item.path) && Number.isInteger(item.line) && item.line > 0).slice(0, 50).map(item => ({
    path: item.path, start_line: item.line, end_line: item.line, annotation_level: item.severity === 'error' ? 'failure' : 'warning',
    message: [item.message, item.fix].filter(Boolean).join('\n').slice(0, 5000),
  }));
  await api('PATCH', '/check-runs/' + context.checkId, { status: 'completed', conclusion, output: {
    title: conclusion === 'success' ? '内容检查通过' : '内容检查未通过',
    summary: issues.length ? issues.map(item => (item.severity === 'error' ? '❌ ' : '⚠️ ') + (item.path || '') + ': ' + item.message).join('\n').slice(0, 20000) : '已验证作者身份、修改范围、Markdown、媒体和构建。',
    annotations,
  } });
}
export function resolvedHead(pulls, head) {
  return pulls.some(pull => pull.state === 'closed' && pull.head?.sha === head);
}
export async function prepare() {
  const { api, repo } = createGithub(), source = event();
  let request;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    const run = await api('GET', '/actions/runs/' + Number(source.workflow_run?.id));
    request = validateSourceRun(run, repo);
  } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === 'refs/heads/main') {
    const branch = source.inputs?.branch;
    if (typeof branch !== 'string' || branch === 'main' || branch.length > 200) throw new Error('Choose an author branch.');
    const ref = await api('GET', '/git/ref/heads/' + encodeURIComponent(branch));
    request = { branch, head: ref.object.sha, actor: await actorForHead(api, ref.object.sha, branch) };
  } else throw new Error('Unsupported publishing request.');
  const current = await api('GET', '/git/ref/heads/' + encodeURIComponent(request.branch));
  if (current.object.sha !== request.head) { output('accepted', 'false'); console.log('A newer push replaced this request.'); return; }
  const base = git('rev-parse', 'HEAD');
  const main = await api('GET', '/git/ref/heads/main');
  if (base !== main.object.sha) throw new Error('Trusted main changed during setup. Rerun this request.');
  fetchRevision(request.head);
  const people = requirePeople((await createIntegration()({ action: 'people' })).people);
  const pulls = await api('GET', '/pulls?state=all&base=main&head=' + encodeURIComponent(repo.split('/')[0] + ':' + request.branch) + '&per_page=100');
  let pull = pulls.find(pull => pull.state === 'open' && pull.head?.sha === request.head);
  if (!pull && resolvedHead(pulls, request.head)) { output('accepted', 'false'); console.log('This exact branch head already has a resolved PR.'); return; }
  if (!pull) pull = await api('POST', '/pulls', { title: '开发日志 · ' + request.branch.slice(0, 100), head: request.branch, base: 'main',
    body: 'Discord 绑定作者的内容发布请求。内容检查通过后自动合并；发布结果会报告到 Discord。' });
  const context = { repo, base, head: request.head, branch: request.branch, actor: request.actor, pr: pull.number,
    people, runId: Number(process.env.GITHUB_RUN_ID), authors: [], accepted: false };
  const started = await api('POST', '/check-runs', { name: CHECK_NAME, head_sha: context.head, status: 'in_progress',
    external_id: context.base + ':' + context.head, details_url: 'https://github.com/' + repo + '/actions/runs/' + context.runId });
  context.checkId = started.id;
  const inspected = inspectCandidate({ root, base, head: context.head, actorId: context.actor.id, author: verifiedActor(people, context.actor.id) });
  const changes = changedPosts(root, base, context.head);
  context.authors = [...new Set(changes.flatMap(change => change.authors))];
  context.affectedPaths = [...new Set([...inspected.changes.map(change => change.path), ...changes.map(change => change.path)])];
  // Historical credit remains visible; new credits must refer to currently eligible members.
  for (const change of changes) for (const authorId of authorIds(change.after)) {
    if (!authorIds(change.before).includes(authorId) && !people.some(person => person.author === authorId && person.active)) {
      inspected.issues.push({ ...issue('author-inactive', '新增署名必须属于已注册且仍有发布资格的成员。', '请该作者先在 Discord 注册，或移除新增署名。'), path: change.path });
    }
  }
  if (pull.draft) inspected.issues.push(issue('draft-pr', '此 PR 仍为草稿。', '将 PR 标记为可以审查，再从 Actions 重新运行发布检查。'));
  context.accepted = inspected.issues.length === 0;
  save('.native/context.json', context);
  output('accepted', String(context.accepted));
  output('base', context.base);
  output('head', context.head);
  if (!context.accepted) {
    await check(api, context, 'failure', inspected.issues);
    await send(context, inspected.issues.some(item => ['site-code', 'unsafe-mode', 'unsafe-path'].includes(item.code)) ? 'policy' : 'validation', inspected.issues);
  }
}
export function build({ stdio = 'inherit' } = {}) {
  const context = json('.native/context.json'), target = resolve('.native/project');
  let result = { head: context.head, base: context.base, issues: [], ok: false };
  try {
    fetchRevision(context.head);
    materializeProject({ root, target, base: context.base, head: context.head, actorId: context.actor.id });
    syncAuthorProfiles({ root: target, people: context.people });
    const validation = validateContent({ root: target, people: context.people });
    result.issues = validation.issues.filter(item => item.severity === 'error' || !item.path || context.affectedPaths?.includes(item.path));
    if (!validation.errors.length) {
      const install = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts'], { cwd: target, stdio, shell: process.platform === 'win32' });
      if (install.status !== 0) throw new Error('Dependency installation failed.');
      const built = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: target, stdio, shell: process.platform === 'win32' });
      if (built.status !== 0) throw new Error('Site build failed.');
      result.ok = true;
    }
  } catch {
    result.issues.push(issue('build-failed', '网站构建未完成。', '查看 GitHub 检查记录中的构建错误并修复；本次未合并。'));
  }
  save('.native/result.json', result);
  if (!result.ok) process.exitCode = 1;
}
export async function finalize() {
  const context = json('.native/context.json'), { api } = createGithub();
  fetchRevision(context.head); fetchRevision(context.base);
  let result;
  try { result = json('.native/result.json'); } catch { result = { issues: [issue('build-missing', '构建没有返回完整结果。', '查看检查记录并重试。')], ok: false }; }
  if (result.head !== context.head || result.base !== context.base) result = { ok: false, issues: [issue('build-stale', '构建结果与待发布版本不一致。', '重新运行当前版本检查。')] };
  if (!Array.isArray(result.issues) || result.issues.length > 2000) throw new Error('Invalid validation result.');
  context.people = requirePeople((await createIntegration()({ action: 'people' })).people);
  if (context.actor.id !== OWNER_ID && !verifiedActor(context.people, context.actor.id)) {
    result.ok = false; result.issues.push(issue('access-revoked', '提交者的发布资格或账号绑定已改变。', '重新确认 Discord 身份和发布资格。'));
  }
  const freshChanges = changedPosts(root, context.base, context.head);
  for (const change of freshChanges) for (const authorId of authorIds(change.after)) {
    if (!authorIds(change.before).includes(authorId) && !context.people.some(person => person.author === authorId && person.active)) {
      result.ok = false;
      result.issues.push({ ...issue('author-inactive', '新增署名作者的发布资格已经改变。', '重新确认作者资格或移除新增署名后重试。'), path: change.path });
    }
  }
  if (process.env.BUILD_RESULT !== 'success' || !result.ok || result.issues.some(item => item.severity === 'error')) {
    await check(api, context, 'failure', result.issues);
    await send(context, 'validation', result.issues);
    throw new Error('Content validation or build failed.');
  }
  try { await assertMergeCurrent({ api, context, appId: process.env.DEVLOG_APP_ID }); }
  catch (error) {
    const issues = [issue('merge-precondition', error.message, '更新分支后重试；若保护设置缺失，请仓库所有者完成部署配置。')];
    await check(api, context, 'action_required', issues); await send(context, 'validation', issues); throw error;
  }
  const changes = changedPosts(root, context.base, context.head);
  const actorAuthor = verifiedActor(context.people, context.actor.id)?.author;
  for (const change of changes) if (change.before && !authorIds(change.before).includes(actorAuthor)) {
    result.issues.push({ severity: 'warning', code: 'cross-author', path: change.path, line: 1, message: '此修改涉及其他作者的日志，将通知原作者与当前署名作者。' });
  }
  if (result.issues.length) await send(context, 'warning', result.issues);
  await check(api, context, 'success', result.issues);
  // The App is deliberately not a protection bypass. Strict required checks also close the
  // main-advance race between this recheck and GitHub's merge transaction.
  await assertMergeCurrent({ api, context, appId: process.env.DEVLOG_APP_ID });
  try {
    const merged = await api('PUT', '/pulls/' + context.pr + '/merge', { sha: context.head, merge_method: 'squash' });
    if (!merged.merged) throw new Error('GitHub did not merge the reviewed commit.');
    console.log('Merged reviewed content: ' + merged.sha);
  } catch (error) {
    await send(context, 'deployment', [issue('merge-failed', '自动合并尚未确认完成。', '查看 PR 当前状态；不要直接推送 main 绕过检查。')], { scope: 'merge:' + context.pr });
    throw error;
  }
}
export async function previousDeployment(api, head) {
  for (let page = 1; page <= 10; page++) {
    const deployments = await api('GET', '/deployments?environment=github-pages&per_page=100&page=' + page);
    for (const deployment of deployments) {
      if (deployment.sha === head || !shaPattern.test(deployment.sha || '')) continue;
      const statuses = await api('GET', '/deployments/' + deployment.id + '/statuses?per_page=100');
      if (statuses.some(status => status.state === 'success')) return deployment.sha;
    }
    if (deployments.length < 100) return null;
  }
  throw new Error('Could not establish the previous successful deployment; reconcile before publishing.');
}
export async function prepareDeployment() {
  const source = event(), { api, repo } = createGithub({ token: process.env.GITHUB_TOKEN });
  const head = process.env.GITHUB_SHA;
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !shaPattern.test(head || '')) throw new Error('Deployments run only from main.');
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && Number(source.sender?.id) !== OWNER_ID) throw new Error('Only the repository owner may dispatch production deployment.');
  const people = requirePeople((await createIntegration()({ action: 'people' })).people);
  let actor = { id: Number(source.sender?.id), login: source.sender?.login }, pr;
  const pulls = await api('GET', '/commits/' + head + '/pulls');
  const merged = pulls.find(pull => pull.merged_at && pull.base.ref === 'main' && pull.merge_commit_sha === head);
  if (merged) { actor = await actorForHead(api, merged.head.sha, merged.head.ref); pr = merged.number; }
  else if (actor.id !== OWNER_ID) throw new Error('Unreviewed direct main changes cannot be deployed.');
  const previous = await previousDeployment(api, head);
  // Empty tree makes first deployment a first-publication event for every public post.
  const base = previous || git('hash-object', '-t', 'tree', '-w', '--stdin');
  if (previous) fetchRevision(previous);
  const context = { repo, head, base, actor, pr, people, runId: Number(process.env.GITHUB_RUN_ID),
    authors: [...new Set(changedPosts(root, base, head).flatMap(change => change.authors))] };
  save('.native/deploy.json', context);
  syncAuthorProfiles({ root, people });
  const validation = validateContent({ root, people });
  save('.native/deploy-validation.json', validation.issues);
  if (validation.errors.length) {
    await send(context, 'validation', validation.issues, { scope: 'deploy-validation' });
    throw new Error('Main content validation failed.');
  }
  const affected = new Set(changedPosts(root, base, head).map(change => change.path));
  const warnings = validation.warnings.filter(item => !item.path || affected.has(item.path));
  if (warnings.length && !pr) await send(context, 'warning', warnings, { scope: 'deploy-validation' });
}
export function profilesDeployment() {
  const context = json('.native/deploy.json');
  if (context.head !== process.env.GITHUB_SHA) throw new Error('Author snapshot belongs to another revision.');
  syncAuthorProfiles({ root, people: requirePeople(context.people) });
}
export async function reportDeployment() {
  const context = json('.native/deploy.json');
  if (process.env.DEPLOY_RESULT !== 'success') {
    await send(context, 'deployment', [issue('deployment-failed', '网站构建或部署失败，此版本尚未确认上线。', '打开检查记录修复错误，再重新运行部署。')], { scope: 'deploy' }); return;
  }
  const site = new URL(process.env.SITE_URL || 'https://kingslayerrq.github.io');
  if (site.protocol !== 'https:') throw new Error('Public site URL must use HTTPS.');
  const basePath = (process.env.BASE_PATH || '/heritage-devlog').replace(/\/$/, '');
  for (const change of changedPosts(root, context.base, context.head)) {
    if (!['publish', 'edit', 'unpublish'].includes(change.kind)) continue;
    const post = change.after || change.before, kind = change.kind === 'unpublish' ? 'edit' : change.kind;
    const url = new URL(basePath + '/posts/' + post.slug.split('/').map(encodeURIComponent).join('/') + '/', site).href;
    const cover = post.data.cover?.startsWith('/media/') ? new URL(basePath + post.data.cover, site).href : undefined;
    await send(context, kind, [], { scope: change.id, authors: change.authors, title: post.data.title,
      ...(change.kind === 'unpublish' ? { summary: '此日志已从公开网站移除。' } : { url, cover, summary: post.data.summary }) });
  }
}


/** Fallback for pushes whose branch request workflow was accidentally removed or renamed. */
export async function reconcile() {
  const { api, repo } = createGithub();
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Reconciliation runs only on main.');
  const main = await api('GET', '/git/ref/heads/main');
  let dispatched = 0;
  for (let page = 1; page <= 10; page++) {
    const branches = await api('GET', '/branches?per_page=100&page=' + page);
    for (const branch of branches) {
      if (branch.name === 'main' || !shaPattern.test(branch.commit?.sha || '')) continue;
      const pulls = await api('GET', '/pulls?state=all&base=main&head=' + encodeURIComponent(repo.split('/')[0] + ':' + branch.name) + '&per_page=100');
      if (resolvedHead(pulls, branch.commit.sha)) continue;
      const checks = await api('GET', '/commits/' + branch.commit.sha + '/check-runs?check_name=' + encodeURIComponent(CHECK_NAME) + '&per_page=100');
      const already = checks.check_runs?.some(check => Number(check.app?.id) === Number(process.env.DEVLOG_APP_ID) &&
        check.head_sha === branch.commit.sha && (check.status !== 'completed' || check.conclusion !== 'success' || check.external_id === main.object.sha + ':' + branch.commit.sha));
      if (already) continue;
      await api('POST', '/actions/workflows/native.yml/dispatches', { ref: 'main', inputs: { branch: branch.name } });
      dispatched++;
      if (dispatched >= 20) { console.log('Reconciliation batch limited to 20 branches; remaining branches wait for the next run.'); return; }
    }
    if (branches.length < 100) break;
  }
  console.log('Dispatched ' + dispatched + ' branch checks.');
}
export function deploymentIsCurrent(mainSha, head) {
  if (!shaPattern.test(mainSha || '') || !shaPattern.test(head || '')) throw new Error('Invalid deployment revision.');
  return mainSha === head;
}
/** Check immediately before Pages promotion, including reruns of older successful runs. */
export async function deploymentCurrent() {
  const { api } = createGithub({ token: process.env.GITHUB_TOKEN });
  const main = await api('GET', '/git/ref/heads/main');
  const current = deploymentIsCurrent(main.object.sha, process.env.GITHUB_SHA);
  output('current', String(current));
  if (!current) console.log('This deployment was superseded by a newer main revision; no Pages promotion or publication report.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const tasks = { prepare, build, finalize, reconcile, 'deploy-current': deploymentCurrent, 'prepare-deploy': prepareDeployment, 'profiles-deploy': profilesDeployment, 'report-deploy': reportDeployment };
  try { if (!tasks[process.argv[2]]) throw new Error('Choose a native publishing task.'); await tasks[process.argv[2]](); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
