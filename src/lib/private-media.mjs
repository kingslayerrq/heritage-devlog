// Private and draft entries are never rendered, but everything under public/media is copied
// into the build as-is. This removes media that only hidden entries reference, so taking an
// entry down also takes its images, videos and models off the deployed site.
// The source repository is public: this hides files from the website, not from GitHub.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';

function walk(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(directory, entry.name), prefix + entry.name + '/')
    : entry.isFile() ? [prefix + entry.name] : []);
}

/** Minimal front-matter read: a hidden entry is a draft or anything not explicitly/implicitly public. */
export function isPublicEntry(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return false;
  const field = name => new RegExp('^' + name + ':[ \\t]*["\']?([A-Za-z]+)["\']?[ \\t]*(?:#.*)?$', 'm').exec(match[1])?.[1];
  return (field('visibility') ?? 'public') === 'public' && (field('draft') ?? 'false') !== 'true';
}

/**
 * Media paths ("/media/a/b.png") to drop from the build: referenced by at least one hidden
 * entry and by no public entry. Unreferenced media is left alone.
 */
export function hiddenOnlyMedia(entries, mediaPaths) {
  const sources = entries.map(entry => {
    let decoded = entry.source;
    try { decoded = decodeURI(entry.source); } catch { /* invalid escapes are a validator error */ }
    return { public: isPublicEntry(entry.source), text: entry.source + '\n' + decoded };
  });
  return mediaPaths.filter(path => {
    const users = sources.filter(entry => entry.text.includes(path));
    return users.length > 0 && users.every(entry => !entry.public);
  });
}

export function pruneHiddenMedia({ root, dist }) {
  const posts = join(root, 'src/content/posts');
  const entries = walk(posts).filter(name => name.endsWith('.md')).map(name => ({ source: readFileSync(join(posts, name), 'utf8') }));
  const mediaRoot = resolve(dist, 'media');
  const removed = hiddenOnlyMedia(entries, walk(mediaRoot).map(name => '/media/' + name));
  for (const path of removed) {
    const target = resolve(mediaRoot, path.slice('/media/'.length));
    if (target.startsWith(mediaRoot + sep)) rmSync(target, { force: true });
  }
  return removed;
}

export function privateMediaIntegration() {
  return {
    name: 'heritage-private-media',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const removed = pruneHiddenMedia({ root: process.cwd(), dist: fileURLToPath(dir) });
        if (removed.length) logger.info('Removed ' + removed.length + ' media file(s) used only by private or draft entries.');
      },
    },
  };
}
