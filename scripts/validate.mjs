// Checks every entry and author profile before the site is built.
//   npm run validate                 check everything
//   npm run validate -- path/to.md   check only the named entry files (authors are always checked)
// Errors stop the deploy; warnings do not. On GitHub the problems are also attached to the files.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const postsDir = join(root, 'src/content/posts'), authorsDir = join(root, 'src/content/authors'), publicDir = join(root, 'public');
const MAX_FILE = 25 * 1024 * 1024, WARN_SITE = 800 * 1024 * 1024;
const POST_KEYS = ['title', 'date', 'discipline', 'authors', 'summary', 'tags', 'cover', 'coverAlt', 'visibility', 'draft'];
const AUTHOR_KEYS = ['name', 'role', 'discipline', 'bio', 'avatar', 'discord', 'links'];
const BLOCKS = ['hx-video', 'hx-gallery', 'hx-compare', 'hx-model', 'hx-blueprint', 'hx-build', 'hx-note'];

// The list of crafts lives in one place; read its keys rather than repeating them here.
const disciplines = [...readFileSync(join(root, 'src/lib/disciplines.ts'), 'utf8').matchAll(/^\s+([a-z]+): \{ name:/gm)].map(match => match[1]);
if (!disciplines.length) throw new Error('Could not read the crafts from src/lib/disciplines.ts.');

const problems = [];
const report = (level, path, line, message) => {
  const file = relative(root, path).replace(/\\/g, '/');
  if (!problems.some(problem => problem.file === file && problem.line === line && problem.message === message)) problems.push({ level, file, line, message });
};
const isText = value => typeof value === 'string' && value.trim() !== '';
const walk = dir => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])) : []);
const keyLine = (lines, key) => Math.max(1, lines.findIndex(line => line.startsWith(`${key}:`)) + 1);

/** A "/media/..." reference must point at a real file under public/, with matching letter case. */
function mediaExists(path) {
  let dir = publicDir;
  for (const part of decodeURI(path).split('/').filter(Boolean)) {
    if (!existsSync(dir) || !readdirSync(dir).includes(part)) return false;
    dir = join(dir, part);
  }
  return statSync(dir).isFile();
}
function checkMedia(file, line, path, what) {
  if (!path.startsWith('/media/')) return;
  if (!mediaExists(path)) report('error', file, line, `${what} points to ${path}, but public${path} does not exist (check spelling and upper/lower case).`);
}

// --- Authors -----------------------------------------------------------------
const authorIds = new Set();
for (const file of walk(authorsDir).filter(path => path.endsWith('.json'))) {
  const id = basename(file, '.json');
  authorIds.add(id);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) report('error', file, 1, 'Author file names use lowercase letters, digits and dashes, and start with a letter.');
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { report('error', file, 1, `Not valid JSON: ${error.message}`); continue; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { report('error', file, 1, 'An author profile must be a JSON object.'); continue; }
  for (const key of Object.keys(data)) if (!AUTHOR_KEYS.includes(key)) report('error', file, 1, `Unknown field "${key}". Allowed: ${AUTHOR_KEYS.join(', ')}.`);
  if (!isText(data.name)) report('error', file, 1, '"name" is required.');
  for (const key of ['role', 'bio', 'avatar']) if (data[key] !== undefined && typeof data[key] !== 'string') report('error', file, 1, `"${key}" must be text.`);
  if (data.discipline !== undefined && !disciplines.includes(data.discipline)) report('error', file, 1, `"discipline" must be one of: ${disciplines.join(', ')}.`);
  if (data.discord !== undefined && !/^\d{15,22}$/.test(String(data.discord))) report('error', file, 1, '"discord" must be a Discord user id (digits only, in quotes).');
  if (data.discord !== undefined && typeof data.discord !== 'string') report('error', file, 1, '"discord" must be written in quotes, or the id loses its last digits.');
  if (typeof data.avatar === 'string') checkMedia(file, 1, data.avatar, 'The avatar');
  if (data.links !== undefined) {
    if (!Array.isArray(data.links)) report('error', file, 1, '"links" must be a list.');
    else for (const link of data.links) {
      let ok = isText(link?.label);
      try { ok &&= ['http:', 'https:'].includes(new URL(link.url).protocol); } catch { ok = false; }
      if (!ok) report('error', file, 1, 'Every link needs a "label" and a full "url" starting with https://.');
    }
  }
}

// --- Entries -----------------------------------------------------------------
const named = process.argv.slice(2).map(path => resolve(path));
const posts = walk(postsDir).filter(path => path.endsWith('.md')).filter(path => !named.length || named.includes(path));
for (const path of named) if (!existsSync(path)) report('error', path, 1, 'This file does not exist.');

for (const file of posts) {
  const name = basename(file, '.md'), text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), lines = text.split('\n');
  const nameMatch = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(name);
  if (!nameMatch) report('error', file, 1, 'Name entry files YYYY-MM-DD-short-title.md, in lowercase with dashes (for example 2026-11-10-opening-the-door.md).');

  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (end < 0) { report('error', file, 1, 'The file must start with front matter between two lines of "---".'); continue; }
  let data;
  try { data = yaml.load(lines.slice(1, end).join('\n')); }
  catch (error) { report('error', file, (error.mark?.line ?? 0) + 2, `The front matter is not valid YAML: ${error.reason || error.message}. Text containing a colon needs quotes.`); continue; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { report('error', file, 1, 'The front matter is empty.'); continue; }
  const at = key => keyLine(lines, key);

  for (const key of Object.keys(data)) if (!POST_KEYS.includes(key)) report('error', file, at(key), `Unknown field "${key}" (a typo?). Allowed: ${POST_KEYS.join(', ')}.`);
  if (!isText(data.title)) report('error', file, at('title'), '"title" is required.');
  else if (data.title.length > 120) report('warning', file, at('title'), 'The title is over 120 characters and will be cut short in Discord.');

  const date = data.date instanceof Date ? data.date : typeof data.date === 'string' ? new Date(data.date) : null;
  if (!date || Number.isNaN(date.valueOf())) report('error', file, at('date'), '"date" is required, written as YYYY-MM-DD.');
  else if (nameMatch && date.toISOString().slice(0, 10) !== nameMatch[1]) report('warning', file, at('date'), `The date (${date.toISOString().slice(0, 10)}) differs from the date in the file name (${nameMatch[1]}).`);

  if (!disciplines.includes(data.discipline)) report('error', file, at('discipline'), `"discipline" is required and must be one of: ${disciplines.join(', ')}.`);

  if (data.authors === undefined) report('warning', file, 1, 'No "authors": the entry will be signed "The Heritage team".');
  else if (!Array.isArray(data.authors) || data.authors.some(id => typeof id !== 'string')) report('error', file, at('authors'), '"authors" must be a list of author ids, for example [your-id, co-author-id].');
  else {
    for (const id of data.authors) if (!authorIds.has(id)) report('error', file, at('authors'), `Author "${id}" has no profile. Add src/content/authors/${id}.json or fix the id.`);
    if (new Set(data.authors).size !== data.authors.length) report('error', file, at('authors'), 'An author is listed twice.');
  }

  if (data.summary === undefined) report('warning', file, 1, 'No "summary": the front page and the Discord announcement will show only the title.');
  else if (!isText(data.summary)) report('error', file, at('summary'), '"summary" must be text.');
  else if (data.summary.length > 300) report('warning', file, at('summary'), 'The summary is over 300 characters; one or two sentences reads best.');

  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some(tag => !isText(tag)))) report('error', file, at('tags'), '"tags" must be a list of words, for example [Puzzles, Front hall].');
  if (data.draft !== undefined && typeof data.draft !== 'boolean') report('error', file, at('draft'), '"draft" must be true or false.');
  if (data.draft === true) report('warning', file, at('draft'), 'This entry is a draft and will not appear on the site.');
  if (data.visibility !== undefined && data.visibility !== 'public') report('error', file, at('visibility'), data.visibility === 'internal'
    ? 'Internal entries must not be committed here: this repository is public, so the file is readable by anyone even though the site hides it.'
    : '"visibility" can only be "public" in this repository.');

  if (data.cover !== undefined) {
    if (!isText(data.cover) || !/^(\/media\/|https:\/\/)/.test(data.cover)) report('error', file, at('cover'), '"cover" must be a path starting with /media/ or a full https:// address.');
    else {
      checkMedia(file, at('cover'), data.cover, 'The cover');
      if (/\.svg$/i.test(data.cover)) report('warning', file, at('cover'), 'Discord cannot show SVG pictures, so the announcement will have no image.');
      if (!isText(data.coverAlt)) report('warning', file, at('cover'), 'Add "coverAlt" describing the cover for people using screen readers.');
    }
  }

  // Body: blank out fenced code so examples inside code blocks are not checked, keeping line numbers intact.
  let fence = null;
  const body = lines.map((line, i) => {
    if (i <= end) return '';
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark && !fence) { fence = mark; return ''; }
    if (fence) { if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null; return ''; }
    return line.replace(/`[^`]*`/g, '');
  });
  if (fence) report('error', file, lines.length, 'A code block is opened with ``` but never closed.');
  if (!lines.slice(end + 1).join('').trim()) report('error', file, end + 1, 'The entry has no content after the front matter.');

  const open = {};
  body.forEach((line, i) => {
    for (const match of line.matchAll(/!?\[[^\]]*\]\((\/media\/[^)\s]+)/g)) checkMedia(file, i + 1, match[1], match[0].startsWith('!') ? 'A picture' : 'A link');
    for (const match of line.matchAll(/<(\/?)(hx-[a-z-]+)([^>]*)>/g)) {
      const [, closing, tag, rest] = match;
      if (!BLOCKS.includes(tag)) { report('error', file, i + 1, `Unknown block <${tag}>. Known blocks: ${BLOCKS.join(', ')}.`); continue; }
      if (closing) { open[tag] = (open[tag] || 0) - 1; continue; }
      open[tag] = (open[tag] || 0) + 1;
      const attrs = Object.fromEntries([...rest.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? '']));
      for (const key of ['src', 'poster', 'before', 'after']) if (attrs[key]) checkMedia(file, i + 1, attrs[key], `<${tag} ${key}>`);
      if (tag === 'hx-video' && !attrs.src && !attrs.youtube) report('error', file, i + 1, '<hx-video> needs src="/media/…" or youtube="VIDEO_ID".');
      if (tag === 'hx-video' && attrs.youtube && !/^[\w-]{6,20}$/.test(attrs.youtube)) report('error', file, i + 1, '<hx-video youtube> takes only the video id (the part after "v="), not the whole link.');
      if (tag === 'hx-compare' && !(attrs.before && attrs.after)) report('error', file, i + 1, '<hx-compare> needs both before="…" and after="…".');
      if (tag === 'hx-model' && !/\.glb$/i.test(attrs.src || '')) report('error', file, i + 1, '<hx-model> needs src pointing to a .glb file.');
      if (tag === 'hx-blueprint') { let host = ''; try { host = new URL(attrs.src).hostname; } catch { /* reported below */ } if (host !== 'blueprintue.com') report('error', file, i + 1, '<hx-blueprint> needs src="https://blueprintue.com/render/…".'); }
      if (['hx-gallery', 'hx-build', 'hx-note'].includes(tag) && !line.includes(`</${tag}>`) && (body[i + 1] ?? '').trim() !== '') report('error', file, i + 1, `Leave a blank line after <${tag}>, or the Markdown inside it will not be formatted.`);
    }
  });
  for (const [tag, count] of Object.entries(open)) if (count !== 0) report('error', file, end + 1, `<${tag}> is ${count > 0 ? 'opened but never closed' : 'closed more often than it is opened'}.`);
}

// --- Media sizes ---------------------------------------------------------------
let total = 0;
for (const file of walk(join(publicDir, 'media'))) {
  const size = statSync(file).size; total += size;
  if (size > MAX_FILE) report('error', file, 1, `This file is ${(size / 1048576).toFixed(0)} MB. Keep files under 25 MB; put long videos on YouTube.`);
}
if (total > WARN_SITE) report('warning', join(publicDir, 'media'), 1, `Media totals ${(total / 1048576).toFixed(0)} MB. GitHub Pages sites are limited to 1 GB.`);

// --- Report ------------------------------------------------------------------
const errors = problems.filter(problem => problem.level === 'error');
for (const problem of problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`${problem.level === 'error' ? 'ERROR  ' : 'warning'}  ${problem.file}:${problem.line}  ${problem.message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::${problem.level} file=${problem.file},line=${problem.line}::${problem.message.replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
}
console.log(`\nChecked ${posts.length} ${posts.length === 1 ? 'entry' : 'entries'} and ${authorIds.size} author ${authorIds.size === 1 ? 'profile' : 'profiles'}: ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}, ${problems.length - errors.length} ${problems.length - errors.length === 1 ? 'warning' : 'warnings'}.`);
if (errors.length) { console.log('Fix the errors above; the site will not be published until they are gone.'); process.exit(1); }
