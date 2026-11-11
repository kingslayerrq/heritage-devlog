// Reports what a set of commits did to files that belong to someone else. It never blocks anything.
//   ACTOR=<github login> BASE=<ref> [HEAD=<ref>] node scripts/check-ownership.mjs
// Used by pull requests (as warnings) and by scripts/guard.mjs after a push to main.
//
// Who owns what:
//   - Repository owners (the "*" line of .github/CODEOWNERS) may change anything.
//   - An author profile belongs to the GitHub account named in its "github" field.
//   - An entry and its public/media/<entry>/ folder belong to the authors listed in its front
//     matter as it stood BEFORE the change, so adding yourself to an entry does not make it yours.
//   - Everything outside src/content/ and public/media/ is the site's own code.
// New files are always fine, whoever they credit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const show = (ref, path) => { try { return git('show', `${ref}:${path}`); } catch { return null; } };

export const repositoryOwners = () => (/^\*\s+(.+)$/m.exec(readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8'))?.[1] || '')
  .split(/\s+/).filter(name => name.startsWith('@')).map(name => name.slice(1).toLowerCase());

/** The GitHub account (lowercase) that owns an author profile at a commit, or '' if none is named. */
export const profileOwner = (ref, id) => { try { return String(JSON.parse(show(ref, `src/content/authors/${id}.json`)).github || '').toLowerCase(); } catch { return ''; } };

function entry(ref, slug) {
  const text = show(ref, `src/content/posts/${slug}.md`);
  if (text === null) return null;
  try {
    const data = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || '') || {};
    return { title: typeof data.title === 'string' ? data.title : slug, authors: Array.isArray(data.authors) ? data.authors.map(String) : [] };
  } catch { return { title: slug, authors: [] }; }
}

/**
 * Classifies every commit on the first-parent line of base..head, as made by `actor`.
 * Returns { actor, isOwner, owners, commits: [{ sha, subject, merge, siteCode, foreign, credited }] }.
 */
export function report({ actor, base, head = 'HEAD' }) {
  actor = actor.toLowerCase();
  const owners = repositoryOwners(), isOwner = owners.includes(actor);
  const start = git('merge-base', base, head).trim();
  const shas = git('rev-list', '--reverse', '--first-parent', `${start}..${head}`).trim().split('\n').filter(Boolean);
  const commits = [];
  for (const sha of shas) {
    const parents = git('rev-list', '--parents', '-n', '1', sha).trim().split(' ').slice(1);
    if (!parents.length) continue;
    const before = parents[0];
    // An author id is the actor's if its profile already named them, or if they created the profile in this push.
    const mine = id => (show(start, `src/content/authors/${id}.json`) === null ? profileOwner(sha, id) : profileOwner(before, id)) === actor;
    const result = { sha, subject: git('log', '-1', '--format=%s', sha).trim(), merge: parents.length > 1, siteCode: [], foreign: [], credited: [] };
    const foreign = (path, status, authors) => result.foreign.push({ path, change: status === 'D' ? 'deleted' : 'changed', authors });
    const changes = git('diff', '--name-status', '--no-renames', before, sha).trim().split('\n').filter(Boolean).map(line => line.split('\t'));
    for (const [status, path] of isOwner ? [] : changes) {
      let match;
      if (!path.startsWith('src/content/') && !path.startsWith('public/media/')) result.siteCode.push(path);
      else if ((match = /^src\/content\/posts\/(.+)\.md$/.exec(path))) {
        const was = entry(before, match[1]), now = entry(sha, match[1]);
        if (was && !was.authors.some(mine)) foreign(path, status, was.authors);
        const added = (now?.authors || []).filter(id => !(was?.authors || []).includes(id) && !mine(id));
        if (added.length) result.credited.push({ path, title: now.title, authors: added });
      } else if (status === 'A') continue;
      else if ((match = /^src\/content\/authors\/([^/]+)\.json$/.exec(path)) || (match = /^public\/media\/authors\/([^/.]+)\.[^/]+$/.exec(path))) {
        if (!mine(match[1])) foreign(path, status, [match[1]]);
      } else if ((match = /^public\/media\/([^/]+)\//.exec(path))) {
        const owner = entry(before, match[1]);
        if (!owner?.authors.some(mine)) foreign(path, status, owner?.authors || []);
      } else foreign(path, status, []);
    }
    commits.push(result);
  }
  return { actor, isOwner, owners, commits };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const actor = process.env.ACTOR;
  if (!actor) { console.error('Set ACTOR to the GitHub login making the change.'); process.exit(2); }
  const result = report({ actor, base: process.env.BASE || 'origin/main', head: process.env.HEAD_REF || 'HEAD' });
  const note = (path, message) => { console.log(`note  ${path}  ${message}`); if (process.env.GITHUB_ACTIONS) console.log(`::warning file=${path}::${message}`); };
  if (result.isOwner) console.log(`${result.actor} is a repository owner: no ownership limits apply.`);
  for (const commit of result.commits) {
    for (const path of commit.siteCode) note(path, `This is the site's own code. It needs approval from an owner (${result.owners.map(name => `@${name}`).join(', ')}); pushed straight to main it is undone automatically.`);
    for (const item of commit.foreign) note(item.path, `This belongs to ${item.authors.join(', ') || 'the repository owners'}, not to you. It is allowed, but they will be told in Discord and an owner may undo it.`);
    for (const item of commit.credited) note(item.path, `${item.authors.join(', ')} will be told they were credited on this entry.`);
  }
  console.log(`${result.commits.length} ${result.commits.length === 1 ? 'commit' : 'commits'} looked at for ${result.actor}. Nothing is blocked by this check.`);
}
