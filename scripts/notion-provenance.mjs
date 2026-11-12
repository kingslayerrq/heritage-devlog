import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tree, changedPaths, safePath } from './native-git.mjs';
import { requirePeople, shaPattern } from './native-api.mjs';

export const notionBranch = /^notion\/([a-f0-9]{64})$/;
const hashPattern = /^[a-f0-9]{64}$/;
export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export const gitBytes = (root, revision, path) => execFileSync('git', ['show', revision + ':' + path], {
  cwd: root, maxBuffer: 26 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
export function validNotionUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['notion.so', 'www.notion.so', 'notion.site'].some(host => url.hostname === host || url.hostname.endsWith('.' + host)) && !url.username && !url.password && !url.port && !url.search && !url.hash; }
  catch { return false; }
}
export function validateManifest(manifest, source, { empty = false } = {}) {
  if (!Array.isArray(manifest) || manifest.length > 21 || (!empty && !manifest.length)) throw new Error('Invalid Notion manifest.');
  const paths = new Set();
  for (const entry of manifest) {
    if (!entry || !safePath(entry.path) || !hashPattern.test(entry.sha256 || '') || paths.has(entry.path) ||
      (entry.path !== source.path && !new RegExp('^public/media/notion-' + source.pageId + '/[a-f0-9]{64}\\.[a-z0-9]{1,10}$').test(entry.path))) throw new Error('Invalid Notion manifest path or hash.');
    paths.add(entry.path);
  }
  if (manifest.length && !paths.has(source.path)) throw new Error('Notion manifest is missing its article.');
  return manifest;
}
export function validateSource(source, { id, head, base, bound = true } = {}) {
  if (!source || !hashPattern.test(source.id || '') || !/^[a-f0-9]{32}$/.test(source.pageId || '') ||
    !hashPattern.test(source.sourceDigest || '') || !/^[a-z][a-z0-9-]{0,79}$/.test(source.actorAuthor || '') ||
    !/^src\/content\/posts\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(source.path || '') || !validNotionUrl(source.sourceUrl)) throw new Error('Invalid trusted Notion source.');
  if ((id && source.id !== id) || (head && source.head !== head) || (base && source.base !== base)) throw new Error('Notion provenance does not match the requested revision.');
  if (bound) {
    if (source.branch !== 'notion/' + source.id || !shaPattern.test(source.head || '') || !shaPattern.test(source.base || '')) throw new Error('Invalid bound Notion revision.');
    validateManifest(source.manifest, source);
  }
  validateManifest(source.previousManifest || [], source, { empty: true });
  return source;
}
export function verifyImportTree(root, source, { revision = source.head, exactDiff = true } = {}) {
  validateSource(source);
  if (!shaPattern.test(revision || '')) throw new Error('Invalid imported revision.');
  const entries = new Map(tree(root, revision).map(entry => [entry.path, entry]));
  for (const item of source.manifest) {
    const entry = entries.get(item.path);
    if (!entry || entry.mode !== '100644' || entry.type !== 'blob' || hashBytes(gitBytes(root, revision, item.path)) !== item.sha256) throw new Error('Notion content does not match its reserved manifest: ' + item.path);
  }
  if (exactDiff) {
    const paths = new Set(source.manifest.map(entry => entry.path));
    const changes = changedPaths(root, source.base, revision);
    if (!changes.length || changes.some(change => !paths.has(change.path) || !['A', 'M'].includes(change.status))) throw new Error('Notion commit contains unreserved changes.');
    const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', revision], { cwd: root, encoding: 'utf8' }).trim().split(' ');
    if (parents.length !== 2 || parents[1] !== source.base) throw new Error('Notion commit must have exactly the reserved base as its parent.');
  }
  return source;
}
export async function authorizeImport({ integration, root, branch, head, base, phase = 'review', fetchRevision }) {
  const match = notionBranch.exec(branch || '');
  if (!match) throw new Error('Invalid reserved Notion branch.');
  const result = await integration({ action: 'notion-authorize', id: match[1], head, phase });
  const source = validateSource(result.source, { id: match[1], head, base });
  const people = requirePeople(result.people);
  const author = people.find(person => person.author === source.actorAuthor && person.active);
  if (!author) throw new Error('Notion submitter no longer has publishing access.');
  if (fetchRevision) { fetchRevision(source.head); fetchRevision(source.base); }
  verifyImportTree(root, source);
  return { source, people, author, actor: { id: 0, login: author.name }, actorAuthor: author.author };
}
