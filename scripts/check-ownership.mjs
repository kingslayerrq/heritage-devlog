// Stops a pull request from changing entries, profiles or media that belong to someone else.
//   ACTOR=<github login> BASE=<ref> node scripts/check-ownership.mjs
// Who owns what:
//   - Repository owners (the "*" line of .github/CODEOWNERS) may change anything.
//   - An author profile belongs to the GitHub account named in its "github" field.
//   - An entry belongs to the authors listed in its front matter, as it stood BEFORE the change,
//     so nobody can add themselves to someone else's entry and then edit it.
//   - public/media/<entry>/ belongs to that entry's authors; public/media/authors/<id>.* to that author.
// The site's own code is not judged here: CODEOWNERS makes GitHub require an owner's approval for it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const actor = (process.env.ACTOR || '').toLowerCase();
const base = process.env.BASE || 'origin/main';
if (!actor) { console.error('Set ACTOR to the GitHub login making the change.'); process.exit(2); }

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const show = (ref, path) => { try { return git('show', `${ref}:${path}`); } catch { return null; } };
const owners = (/^\*\s+(.+)$/m.exec(readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8'))?.[1] || '').split(/\s+/).filter(name => name.startsWith('@')).map(name => name.slice(1).toLowerCase());
if (owners.includes(actor)) { console.log(`${actor} is a repository owner: no ownership limits apply.`); process.exit(0); }

const mergeBase = git('merge-base', base, 'HEAD').trim();
const changes = git('diff', '--name-status', '--no-renames', mergeBase, 'HEAD').trim().split('\n').filter(Boolean).map(line => { const [status, path] = line.split('\t'); return { status, path }; });

const profileOwner = (ref, id) => { try { return String(JSON.parse(show(ref, `src/content/authors/${id}.json`)).github || '').toLowerCase(); } catch { return ''; } };
function entryAuthors(ref, slug) {
  const text = show(ref, `src/content/posts/${slug}.md`);
  if (text === null) return null;
  try { const data = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || ''); return Array.isArray(data?.authors) ? data.authors.map(String) : []; } catch { return []; }
}
// An author id is "mine" if its profile already named me, or if I am creating the profile in this change.
const mine = id => (show(mergeBase, `src/content/authors/${id}.json`) === null ? profileOwner('HEAD', id) : profileOwner(mergeBase, id)) === actor;
const ownsEntry = (ref, slug) => (entryAuthors(ref, slug) || []).some(mine);

const problems = [];
const deny = (path, message) => problems.push({ path, message });
for (const { status, path } of changes) {
  let match;
  if ((match = /^src\/content\/authors\/([^/]+)\.json$/.exec(path))) {
    const id = match[1];
    if (status === 'A') { if (profileOwner('HEAD', id) !== actor) deny(path, `A new profile must name its owner: add "github": "${actor}" to it. Only an owner can create a profile for someone else.`); }
    else if (profileOwner(mergeBase, id) !== actor) deny(path, 'This profile belongs to someone else (its "github" field is not your account).');
    else if (status === 'M' && profileOwner('HEAD', id) !== actor) deny(path, 'You cannot change or remove the "github" field of your profile; ask an owner.');
  } else if ((match = /^src\/content\/posts\/(.+)\.md$/.exec(path))) {
    const slug = match[1];
    if (status === 'A') { if (!ownsEntry('HEAD', slug)) deny(path, 'List your own author id under "authors" in a new entry. (Your id is the name of your profile file, which must have "github" set to your account.)'); }
    else if (!ownsEntry(mergeBase, slug)) deny(path, `You are not one of this entry's authors (${(entryAuthors(mergeBase, slug) || []).join(', ') || 'the team'}), so you cannot ${status === 'D' ? 'delete' : 'change'} it. Ask one of them or an owner.`);
  } else if ((match = /^public\/media\/authors\/([^/.]+)\.[^/]+$/.exec(path))) {
    if (!mine(match[1])) deny(path, 'This is another author\'s picture. Yours is public/media/authors/<your-id>.<ext>.');
  } else if ((match = /^public\/media\/([^/]+)\//.exec(path))) {
    const slug = match[1], existed = entryAuthors(mergeBase, slug) !== null;
    if (!(existed ? ownsEntry(mergeBase, slug) : ownsEntry('HEAD', slug))) deny(path, existed || entryAuthors('HEAD', slug) !== null
      ? 'This media belongs to an entry you are not an author of.'
      : `Media folders are named after an entry. There is no entry called "${slug}"; put files in public/media/<your-entry-file-name>/.`);
  } else if (path.startsWith('public/media/') || path.startsWith('src/content/')) deny(path, 'Only an owner can change this file.');
}

for (const { path, message } of problems) {
  console.log(`BLOCKED  ${path}  ${message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=${path}::${message}`);
}
console.log(`\n${changes.length} changed ${changes.length === 1 ? 'file' : 'files'} checked for ${actor}: ${problems.length} not allowed.`);
if (problems.length) { console.log(`Repository owners (${owners.map(name => `@${name}`).join(', ')}) can make these changes for you.`); process.exit(1); }
