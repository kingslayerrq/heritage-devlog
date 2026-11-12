import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parsePost, isAuthorContentPath, validateContent } from '../scripts/content-policy.mjs';
import { authorProfile, profilesFromPeople, syncAuthorProfiles } from '../scripts/content-profiles.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
function glb(document = { asset: { version: '2.0' } }) { const json = Buffer.from(JSON.stringify(document)); const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16); return Buffer.concat([header, json]); }
const FENCE = String.fromCharCode(96).repeat(3);
const person = { author: 'author-one', discord: '123456789012345678', name: '作者一', avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png', active: true };
const postPath = 'src/content/posts/2026-11-11-中文标题.md';
const entry = (extra = '', body = '正文 **加粗**，保持作者自己的话。') => '---\ntitle: 中文标题\ndate: 2026-11-11\ndiscipline: tech\nauthors: [author-one]\nsummary: 一句话摘要\ntags: [开发, 技术]\n' + extra + '---\n\n' + body + '\n';
function fixture(t, source = entry()) {
  const root = mkdtempSync(join(tmpdir(), 'heritage-content-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  put(postPath, source);
  syncAuthorProfiles({ root, people: [person] });
  return { root, put, check: people => validateContent({ root, people }) };
}
const has = (result, code) => result.issues.some(issue => issue.code === code);

test('parses native YAML including quoted colons without rewriting content', () => {
  const parsed = parsePost(entry('coverAlt: "门: 细节"\n', '手写内容\n\n' + FENCE + 'js\nconsole.log("原样");\n' + FENCE));
  assert.equal(parsed.data.title, '中文标题');
  assert.equal(parsed.data.date, '2026-11-11');
  assert.equal(parsed.data.coverAlt, '门: 细节');
  assert.equal(parsePost(entry('coverAlt: |\n  第一行\n  第二行\n')).data.coverAlt, '第一行\n第二行\n');
  assert.match(parsed.body, /console\.log\("原样"\)/);
  assert.throws(() => parsePost('---\ntitle: first\ntitle: second\n---\n'), /YAML/);
});

test('content paths exclude site code, generated identities, traversal and executable assets', () => {
  for (const path of [postPath, 'src/content/posts/2026-11-11-entry.md', 'public/media/entry/图.png', 'public/media/entry/model.glb']) assert.equal(isAuthorContentPath(path), true, path);
  for (const path of ['src/content/authors/author-one.json', 'public/media/authors/a.png', 'public/media/Authors/a.png', '.github/workflows/check.yml', 'public/media/a.js', 'public/media/x/a.html', 'public/media/x/a.svg.js', 'src/content/posts/x.mdx', 'public/media/x/../x.png', 'public/media/x/a%2fb.png', 'public/media/x/NUL.png', 'src\\content\\posts\\x.md']) assert.equal(isAuthorContentPath(path), false, path);
});

test('Discord is required and GitHub optional; snapshots strip unrelated fields', () => {
  assert.deepEqual(authorProfile({ ...person, token: 'secret', email: 'private@example.com' }), { name: person.name, discord: person.discord, generated: true, active: true, avatar: person.avatarUrl });
  assert.equal(authorProfile({ ...person, github: 'octocat', githubId: 1 }).githubId, 1);
  assert.throws(() => authorProfile({ ...person, github: 'octocat' }), /verified ID/);
  assert.throws(() => authorProfile({ ...person, discord: undefined }), /Discord/);
  assert.throws(() => authorProfile({ ...person, avatarUrl: 'https://cdn.discordapp.com.attacker.invalid/x.png' }), /CDN/);
  assert.throws(() => profilesFromPeople([person, { ...person, author: 'other' }]), /duplicate/);
});

test('Chinese content validates against generated registry', t => {
  const f = fixture(t);
  const result = f.check([person]);
  assert.equal(result.errors.length, 0, JSON.stringify(result.issues));
  assert.equal(result.posts[0].data.title, '中文标题');
  assert.equal(result.posts[0].slug, '2026-11-11-中文标题');
});

test('candidate profile cannot spoof Discord identity', t => {
  const f = fixture(t);
  f.put('src/content/authors/author-one.json', JSON.stringify({ ...authorProfile(person), discord: '999999999999999999' }));
  assert.equal(has(f.check([person]), 'identity.changed'), true);
});

test('new articles cannot use unregistered or demo coauthors', t => {
  const f = fixture(t, entry().replace('[author-one]', '[sample-author, missing-author]'));
  f.put('src/content/authors/sample-author.json', JSON.stringify({ name: 'Sample', demo: true }));
  assert.equal(f.check([person]).errors.filter(issue => issue.code === 'post.unknown-author').length, 2);
});

test('existing sample articles remain valid but cannot be copied under demo identities', t => {
  const f = fixture(t);
  for (const name of ['2026-11-10-opening-the-door.md', '2026-11-11-everything-a-page-can-hold.md']) f.put('src/content/posts/' + name, readFileSync(resolve('src/content/posts/' + name), 'utf8'));
  for (const id of ['heritage-team', 'sample-author']) f.put('src/content/authors/' + id + '.json', JSON.stringify({ name: id, demo: true }));
  for (const name of ['hall', 'study', 'attic', 'blockout', 'lit']) f.put('public/media/sample/' + name + '.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  assert.equal(f.check([person]).errors.length, 0, JSON.stringify(f.check([person]).issues));
  f.put('src/content/posts/2026-11-12-copied.md', readFileSync(resolve('src/content/posts/2026-11-10-opening-the-door.md'), 'utf8'));
  assert.equal(has(f.check([person]), 'post.unknown-author'), true);
});

test('all existing rich blocks and literal code examples remain valid', t => {
  const body = [
    '<hx-gallery caption="画廊">', '', '![图片](/media/entry/image.png)', '', '</hx-gallery>', '',
    '<hx-compare before="/media/entry/image.png" after="/media/entry/image.png"></hx-compare>',
    '<hx-video youtube="abcdef12345"></hx-video>',
    '<hx-video src="/media/entry/clip.mp4" loop></hx-video>',
    '<hx-model src="/media/entry/model.glb" alt="模型"></hx-model>',
    '<hx-blueprint src="https://blueprintue.com/render/abc123/"></hx-blueprint>',
    '<hx-build version="1.0" date="2026-11-11">', '', '- 完成', '', '</hx-build>',
    '<hx-note kind="clue">', '', '提示', '', '</hx-note>',
    '', FENCE + 'html', '<script>alert("literal example")</script>', FENCE,
    '', FENCE + 'mermaid', 'graph TD; A-->B;', FENCE, '', '$x = 2$',
  ].join('\n');
  const f = fixture(t, entry('', body));
  f.put('public/media/entry/image.png', PNG);
  f.put('public/media/entry/clip.mp4', MP4);
  f.put('public/media/entry/model.glb', glb());
  assert.equal(f.check().errors.length, 0, JSON.stringify(f.check().issues));
});

test('HTML parsing rejects scripts, event handlers, encoded URLs and foreign content', t => {
  for (const body of ['<script>alert(1)</script>', '<img src="https://example.com/i.png" onerror="alert(1)">', '<a href="jav&#x61;script:alert(1)">bad</a>', '<iframe src="https://example.com"></iframe>', '<svg><a href="javascript:alert(1)">bad</a></svg>', '<hx-note style="position:fixed">bad</hx-note>']) {
    const f = fixture(t, entry('', body)); assert.ok(f.check().errors.length, body);
  }
});

test('reference URLs and unsafe model or embed sources are rejected', t => {
  for (const body of ['[run][target]\n\n[target]: javascript:alert(1)', '![bad](data:image/svg+xml;base64,AAAA)', '<hx-model src="https://example.com/m.glb"></hx-model>', '<hx-blueprint src="http://blueprintue.com/render/x/"></hx-blueprint>', '<hx-blueprint src="https://blueprintue.com@attacker.invalid/render/x/"></hx-blueprint>']) {
    const f = fixture(t, entry('', body)); assert.ok(f.check().errors.length, body);
  }
});

test('media references enforce exact case and reject encoded traversal', t => {
  const f = fixture(t, entry('', '![wrong](/media/entry/IMAGE.png)\n![traverse](/media/entry/%2e%2e/secret.txt)'));
  f.put('public/media/entry/image.png', PNG);
  assert.equal(has(f.check(), 'media.missing'), true);
  assert.equal(has(f.check(), 'url.unsafe'), true);
});

test('unclosed custom blocks and fences produce actionable diagnostics', t => {
  const f = fixture(t, entry('', '<hx-note>\n\nForgot close\n\n' + FENCE + 'js\nconst missing = 1;'));
  assert.equal(has(f.check(), 'block.unclosed'), true);
  assert.equal(has(f.check(), 'code.unclosed'), true);
  assert.ok(f.check().errors.every(issue => Number.isInteger(issue.line) && issue.message));
});

test('active SVG and oversized media fail; static SVG is retained', t => {
  const f = fixture(t);
  f.put('public/media/entry/static.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h2" fill="red"/></svg>');
  assert.equal(f.check().errors.length, 0);
  f.put('public/media/entry/unsafe.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  f.put('public/media/entry/huge.png', Buffer.alloc(25 * 1024 * 1024 + 1));
  assert.equal(has(f.check(), 'media.svg'), true);
  assert.equal(has(f.check(), 'media.size'), true);
});

test('linked media directories are rejected rather than traversed', t => {
  const f = fixture(t);
  const external = mkdtempSync(join(tmpdir(), 'heritage-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  mkdirSync(join(f.root, 'public/media'), { recursive: true });
  try { symlinkSync(external, join(f.root, 'public/media/link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS cannot create symlinks'); throw error; }
  assert.equal(has(f.check(), 'file.symlink'), true);
});

test('missing summary and cover alt warn; internal content blocks', t => {
  const f = fixture(t, entry('cover: /media/entry/image.png\n').replace('summary: 一句话摘要\n', ''));
  f.put('public/media/entry/image.png', PNG);
  assert.equal(f.check().errors.length, 0);
  assert.equal(has(f.check(), 'post.summary'), true);
  assert.equal(has(f.check(), 'post.cover-alt'), true);
  f.put(postPath, entry('visibility: internal\n'));
  assert.equal(has(f.check(), 'post.visibility'), true);
});

test('invalid dates, missing authors and duplicate stable IDs fail', t => {
  const f = fixture(t, entry('entryId: stable-post-001\n').replace('2026-11-11', '2026-02-30'));
  f.put('src/content/posts/2026-11-12-second.md', entry('entryId: stable-post-001\n'));
  assert.equal(has(f.check(), 'post.date'), true);
  assert.equal(has(f.check(), 'post.duplicate-id'), true);
  f.put(postPath, entry().replace('authors: [author-one]', 'authors: []'));
  assert.equal(has(f.check(), 'post.authors'), true);
});

test('fake image content and externally referencing GLB are rejected', t => {
  const f = fixture(t);
  f.put('public/media/entry/fake.png', '<html><script>alert(1)</script></html>');
  f.put('public/media/entry/external.glb', glb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.com/a.png' }] }));
  assert.equal(f.check().errors.filter(issue => issue.code === 'media.signature').length, 2);
});

test('publication config uses no-op processing and empty remote optimizer allowlists', async () => {
  const { default: config } = await import('../astro.config.mjs');
  assert.equal(config.image.service.entrypoint, 'astro/assets/services/noop');
  assert.deepEqual(config.image.domains, []);
  assert.deepEqual(config.image.remotePatterns, []);
});

test('inactive verified profiles retain historical public attribution', t => {
  const f = fixture(t);
  syncAuthorProfiles({ root: f.root, people: [{ ...person, active: false }] });
  assert.equal(f.check([{ ...person, active: false }]).errors.length, 0);
});

test('a requested missing file is an error rather than a vacuous successful check', t => {
  const f = fixture(t);
  assert.equal(has(validateContent({ root: f.root, paths: ['src/content/posts/2026-11-11-missing.md'] }), 'file.missing'), true);
});

test('offline missing identity warns only when explicitly allowed; CI remains strict', t => {
  const f = fixture(t, entry().replace('[author-one]', '[new-author]'));
  assert.equal(has(validateContent({ root: f.root, allowUnresolvedAuthors: true }), 'post.identity-deferred'), true);
  assert.equal(validateContent({ root: f.root, allowUnresolvedAuthors: true }).errors.length, 0);
  assert.equal(has(validateContent({ root: f.root, people: [person], allowUnresolvedAuthors: true }), 'post.unknown-author'), true);
  assert.equal(has(validateContent({ root: f.root }), 'post.unknown-author'), true);
});
test('malformed UTF-8 never silently changes author wording', t => {
  const f = fixture(t);
  f.put(postPath, Buffer.concat([Buffer.from(entry()), Buffer.from([0xc0, 0x80])]));
  assert.equal(has(f.check(), 'document.encoding'), true);
});
