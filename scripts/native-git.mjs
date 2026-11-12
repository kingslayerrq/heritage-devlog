import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { isAuthorContentPath, parsePost } from './content-policy.mjs';
import { OWNER_ID, shaPattern } from './native-api.mjs';

const git = (root, args, encoding = 'utf8') => execFileSync('git', args, { cwd: root, encoding, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
export function tree(root, revision) {
  if (!shaPattern.test(revision)) throw new Error('Invalid revision.');
  return git(root, ['ls-tree', '-rz', '--full-tree', revision]).split('\0').filter(Boolean).map(line => {
    const match = /^([0-7]+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error('Invalid Git tree.');
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
}
export function readBlob(root, revision, path) {
  try { return git(root, ['show', revision + ':' + path]); } catch { return null; }
}
export function changedPaths(root, base, head) {
  if (![base, head].every(value => shaPattern.test(value))) throw new Error('Invalid revisions.');
  const fields = git(root, ['diff', '--name-status', '--no-renames', '-z', base, head]).split('\0');
  const changes = [];
  for (let i = 0; i < fields.length - 1; i += 2) {
    const [status, path] = fields.slice(i, i + 2);
    if (!['A', 'M', 'D', 'T'].includes(status) || !path) throw new Error('Unsupported Git change.');
    changes.push({ status, path });
  }
  return changes;
}
export function safePath(path) {
  return typeof path === 'string' && path.length <= 240 && !/[\u0000-\u001f\\:]/.test(path) &&
    !path.startsWith('/') && path.split('/').every(part => part && !['.', '..'].includes(part) && !/[. ]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part));
}
export function policyIssues({ changes, entries, actorId, author, baseIsAncestor = true }) {
  const issues = [];
  const owner = Number(actorId) === OWNER_ID;
  if (!owner && !author) issues.push({ severity: 'error', code: 'account-unlinked', path: '', line: 1,
    message: '提交者尚未绑定有资格发布的 Discord 作者身份。', fix: '在 Discord 使用 /devlog-access register 和 /devlog-access link-github，然后重新运行检查。' });
  if (!baseIsAncestor) issues.push({ severity: 'error', code: 'stale-base', path: '', line: 1,
    message: '分支没有包含 main 的最新版本。', fix: '先合并或 rebase 最新 main，再推送分支重试。' });
  if (changes.length > 1000) issues.push({ severity: 'error', code: 'too-many-files', path: '', line: 1, message: '单次提交超过 1000 个文件。', fix: '请拆分为较小的内容提交。' });
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  for (const change of changes) {
    if (!safePath(change.path)) issues.push({ severity: 'error', code: 'unsafe-path', path: change.path, line: 1, message: '文件路径不受支持。', fix: '使用普通相对路径，不包含控制字符或特殊目录。' });
    if (!owner && !isAuthorContentPath(change.path)) issues.push({ severity: 'error', code: 'site-code', path: change.path, line: 1,
      message: '作者分支只能修改日志 Markdown 和日志媒体；身份资料由 Discord 绑定自动生成。', fix: '撤回此文件的修改后重新推送。网站代码只允许仓库所有者修改。' });
    const entry = byPath.get(change.path);
    if (entry && (entry.type !== 'blob' || !['100644', ...(owner ? ['100755'] : [])].includes(entry.mode))) issues.push({ severity: 'error', code: 'unsafe-mode', path: change.path, line: 1, message: '不允许符号链接、子模块或可执行内容文件。', fix: '提交普通文件。' });
  }
  return issues;
}
export function inspectCandidate({ root, base, head, actorId, author }) {
  const changes = changedPaths(root, base, head), entries = tree(root, head);
  let baseIsAncestor = true;
  try { git(root, ['merge-base', '--is-ancestor', base, head]); } catch { baseIsAncestor = false; }
  return { changes, issues: policyIssues({ changes, entries, actorId, author, baseIsAncestor }) };
}
function destination(root, path) {
  if (!safePath(path)) throw new Error('Unsafe repository path.');
  const target = resolve(root, path), prefix = resolve(root) + sep;
  if (!target.startsWith(prefix)) throw new Error('Path escapes project directory.');
  return target;
}
/** Only a secretless job calls this; contributor source is never executed by a privileged job. */
export function materializeProject({ root, target, base, head, actorId }) {
  const owner = Number(actorId) === OWNER_ID;
  const baseRevision = owner ? head : base;
  const entries = tree(root, baseRevision);
  const candidate = tree(root, head);
  const changes = changedPaths(root, base, head);
  if (policyIssues({ changes, entries: candidate, actorId, author: true }).length) throw new Error('Candidate failed path/mode policy.');
  mkdirSync(target, { recursive: true });
  for (const entry of entries) {
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new Error('Unsupported source tree mode.');
    const output = destination(target, entry.path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, git(root, ['cat-file', 'blob', entry.oid], null));
    if (entry.mode === '100755') chmodSync(output, 0o755);
  }
  if (!owner) for (const change of changes) {
    const output = destination(target, change.path);
    if (change.status === 'D') { if (existsSync(output)) unlinkSync(output); }
    else {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, git(root, ['show', head + ':' + change.path], null));
    }
  }
}
export function postAt(root, revision, path) {
  const source = readBlob(root, revision, path);
  if (source === null) return null;
  try { const post = parsePost(source, { path }); return { path, source, slug: path.replace(/^src\/content\/posts\//, '').replace(/\.md$/, ''), ...post }; }
  catch { return { path, source, data: { title: path, authors: [], draft: true } }; }
}
export const authorIds = post => Array.isArray(post?.data?.authors) ? post.data.authors.filter(value => typeof value === 'string') : [];
export function changedPosts(root, base, head) {
  const paths = new Set(changedPaths(root, base, head).filter(change => /^src\/content\/posts\/.+\.md$/.test(change.path)).map(change => change.path));
  // Media-only edits are visible article edits too, including shared media references.
  const media = changedPaths(root, base, head).filter(change => change.path.startsWith('public/media/')).map(change => change.path.slice('public'.length));
  if (media.length) for (const entry of tree(root, head).filter(item => /^src\/content\/posts\/.+\.md$/.test(item.path))) {
    const source = readBlob(root, head, entry.path);
    let decoded = source; try { decoded = decodeURI(source); } catch { /* Invalid escapes remain validator errors. */ }
    if (media.some(path => source?.includes(path) || decoded?.includes(path))) paths.add(entry.path);
  }
  return [...paths].map(path => {
    const before = postAt(root, base, path), after = postAt(root, head, path);
    const beforePublic = Boolean(before && !before.data.draft && before.data.visibility !== 'internal');
    const afterPublic = Boolean(after && !after.data.draft && after.data.visibility !== 'internal');
    return { path, before, after, kind: afterPublic ? beforePublic ? 'edit' : 'publish' : beforePublic ? 'unpublish' : 'draft',
      authors: [...new Set([...authorIds(before), ...authorIds(after)])],
      id: after?.data.entryId || before?.data.entryId || path };
  });
}
