import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hiddenOnlyMedia, isPublicEntry, pruneHiddenMedia } from '../src/lib/private-media.mjs';
import { makeReport } from '../scripts/report-discord.mjs';

const entry = (extra, body = '') => '---\ntitle: "Entry"\ndate: 2026-11-11\ndiscipline: tech\nauthors: [writer]\n' + extra + '---\n\n' + body + '\n';

test('only explicitly or implicitly public, non-draft entries count as public', () => {
  assert.equal(isPublicEntry(entry('')), true);
  assert.equal(isPublicEntry(entry('visibility: public\ndraft: false\n')), true);
  assert.equal(isPublicEntry(entry('visibility: "public" # shown\n')), true);
  assert.equal(isPublicEntry(entry('visibility: private\n')), false);
  assert.equal(isPublicEntry(entry("visibility: 'private'\n")), false);
  assert.equal(isPublicEntry(entry('draft: true\n')), false);
  assert.equal(isPublicEntry(entry('visibility: internal\n')), false);
  assert.equal(isPublicEntry('no front matter'), false);
  // A body line that looks like metadata cannot make a private entry public.
  assert.equal(isPublicEntry(entry('visibility: private\n', 'visibility: public')), false);
});

test('media is dropped only when every entry that uses it is hidden', () => {
  const media = ['/media/a/only-private.png', '/media/a/shared.png', '/media/a/public.png', '/media/a/unused.png', '/media/a/draft only.png'];
  const entries = [
    { source: entry('visibility: private\n', '![x](/media/a/only-private.png) ![y](/media/a/shared.png)') },
    { source: entry('', '![y](/media/a/shared.png) ![z](/media/a/public.png)') },
    { source: entry('draft: true\n', '![d](/media/a/draft%20only.png)') },
  ];
  assert.deepEqual(hiddenOnlyMedia(entries, media), ['/media/a/only-private.png', '/media/a/draft only.png']);
});

test('pruning removes hidden-only files from the build output and nothing else', t => {
  const root = mkdtempSync(join(tmpdir(), 'heritage-private-media-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content = 'x') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  put('src/content/posts/2026-11-11-hidden.md', entry('visibility: private\n', '<hx-video src="/media/hidden/clip.mp4"></hx-video> ![s](/media/shared/s.png)'));
  put('src/content/posts/2026-11-11-shown.md', entry('', '![s](/media/shared/s.png)'));
  for (const file of ['dist/media/hidden/clip.mp4', 'dist/media/shared/s.png', 'dist/media/other/unused.png', 'dist/index.html', 'public/media/hidden/clip.mp4']) put(file);
  assert.deepEqual(pruneHiddenMedia({ root, dist: join(root, 'dist') }), ['/media/hidden/clip.mp4']);
  assert.equal(existsSync(join(root, 'dist/media/hidden/clip.mp4')), false);
  for (const kept of ['dist/media/shared/s.png', 'dist/media/other/unused.png', 'dist/index.html', 'public/media/hidden/clip.mp4']) assert.equal(existsSync(join(root, kept)), true, kept);
  assert.deepEqual(pruneHiddenMedia({ root, dist: join(root, 'missing') }), []);
});

test('the private confirmation report names no article address', () => {
  const report = makeReport({ kind: 'private', repo: 'owner/repo', revision: 'a'.repeat(40), title: 'Hidden entry', actorId: 1, actorLogin: 'writer',
    people: [{ author: 'writer', discord: '123456789012345678', githubId: 1, name: 'Writer', active: true }], authors: ['writer'] });
  const embed = report.embeds[0];
  assert.ok(embed.title.includes('私密') && embed.title.includes('Hidden entry'));
  assert.ok(embed.description.includes('不会出现在网站上') && embed.description.includes('公开仓库'));
  assert.ok(!JSON.stringify(report).includes('/posts/'));
  assert.deepEqual(report.allowed_mentions.users, ['123456789012345678']);
});
