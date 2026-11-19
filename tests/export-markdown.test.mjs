import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportMarkdown, flattenBody } from '../src/lib/export-markdown.mjs';

const BASE = 'https://example.org/devlog';
const flat = body => flattenBody(body, { mediaBase: BASE });

test('the header carries the title, facts, link back and cover', () => {
  const output = exportMarkdown({
    body: 'Body text.', title: 'First playtest', summary: 'What we\n  learned.', date: 'November 11, 2026', disciplineName: 'Design',
    authors: ['Ada', 'Lin'], tags: ['Playtesting', 'Doors'], cover: '/media/a/cover.png', coverAlt: 'A [door]',
    pageUrl: BASE + '/posts/a/', mediaBase: BASE,
  });
  assert.equal(output, [
    '# First playtest',
    '> What we learned.',
    '**November 11, 2026** · Design · by Ada, Lin · Tags: Playtesting, Doors',
    `Originally published at <${BASE}/posts/a/>`,
    `![A \\[door\\]](${BASE}/media/a/cover.png)`,
    'Body text.',
  ].join('\n\n') + '\n');
});

test('optional header fields can be absent', () => {
  const output = exportMarkdown({ body: 'Body.', title: 'Plain', date: 'November 11, 2026', disciplineName: 'Tech', authors: ['Ada'], pageUrl: BASE + '/posts/p/', mediaBase: BASE });
  assert.equal(output, `# Plain\n\n**November 11, 2026** · Tech · by Ada\n\nOriginally published at <${BASE}/posts/p/>\n\nBody.\n`);
});

test('media paths become absolute in images, links and definitions, but not in code', () => {
  const output = flat([
    '![A door](/media/a/door.png) and [the notes (PDF)](/media/a/notes.pdf).',
    '',
    '[![Thumb](/media/a/thumb.png)](/media/a/full.png)',
    '',
    '![Spaced](</media/a/my door.png> "Title")',
    '',
    '[ref]: /media/a/ref.png',
    '',
    'Inline `![x](/media/a/code.png)` stays, and [elsewhere](https://example.com/media/x.png) too.',
    '',
    '```md',
    '![x](/media/a/fenced.png)',
    '```',
  ].join('\n'));
  assert.ok(output.includes(`![A door](${BASE}/media/a/door.png) and [the notes (PDF)](${BASE}/media/a/notes.pdf).`));
  assert.ok(output.includes(`[![Thumb](${BASE}/media/a/thumb.png)](${BASE}/media/a/full.png)`));
  assert.ok(output.includes(`![Spaced](<${BASE}/media/a/my door.png> "Title")`));
  assert.ok(output.includes(`[ref]: ${BASE}/media/a/ref.png`));
  assert.ok(output.includes('`![x](/media/a/code.png)`'));
  assert.ok(output.includes('[elsewhere](https://example.com/media/x.png)'));
  assert.ok(output.includes('```md\n![x](/media/a/fenced.png)\n```'));
});

test('a gallery becomes separate images followed by its caption', () => {
  const output = flat('Before.\n\n<hx-gallery caption="Three *rooms*">\n\n![Hall](/media/s/hall.svg)\n![Study](/media/s/study.svg)\n\n</hx-gallery>\n\nAfter.');
  assert.equal(output, `Before.\n\n![Hall](${BASE}/media/s/hall.svg)\n\n![Study](${BASE}/media/s/study.svg)\n\n*Three \\*rooms\\**\n\nAfter.`);
});

test('a gallery without a caption leaves no gap', () => {
  assert.equal(flat('<hx-gallery>\n\n![Hall](/media/s/hall.svg)\n\n</hx-gallery>\n\nAfter.'), `![Hall](${BASE}/media/s/hall.svg)\n\nAfter.`);
});

test('a comparison becomes two labelled images', () => {
  const output = flat('<hx-compare before="/media/s/a.svg" after="/media/s/b.svg" before-label="Blockout" after-label="Lit" caption="Drag to compare"></hx-compare>');
  assert.equal(output, `**Blockout**\n\n![Blockout](${BASE}/media/s/a.svg)\n\n**Lit**\n\n![Lit](${BASE}/media/s/b.svg)\n\n*Drag to compare*`);
});

test('videos, models and blueprints become links', () => {
  assert.equal(flat('<hx-video youtube="aqz-KE-bpKQ" caption="Full run"></hx-video>'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ\n\n*Full run*');
  assert.equal(flat('<hx-video src="/media/s/clip.mp4" poster="/media/s/poster.webp" caption="Open the box > look"></hx-video>'),
    `![Open the box > look](${BASE}/media/s/poster.webp)\n\n[Video: Open the box > look](${BASE}/media/s/clip.mp4)`);
  assert.equal(flat('<hx-video src="/media/s/clip.mp4"></hx-video>'), `[Video: watch the clip](${BASE}/media/s/clip.mp4)`);
  assert.equal(flat('<hx-model src="/media/s/key.glb" alt="The brass key" caption="Turn it over"></hx-model>'), `[3D model: The brass key](${BASE}/media/s/key.glb)\n\n*Turn it over*`);
  assert.equal(flat('<hx-blueprint src="https://blueprintue.com/render/abc/" caption="Door graph"></hx-blueprint>'), '[Blueprint: Door graph](https://blueprintue.com/render/abc/)');
});

test('build notes keep their list under a plain heading line', () => {
  const output = flat('<hx-build version="0.1.0" changelist="1024" date="2026-11-11">\n\n- Added the hall.\n- Fixed the clock.\n\n</hx-build>\n\nNext.');
  assert.equal(output, '**Build 0.1.0** · Changelist 1024 · 2026-11-11\n\n- Added the hall.\n- Fixed the clock.\n\nNext.');
});

test('notes become blockquotes, and a clue is labelled', () => {
  assert.equal(flat('<hx-note>\n\nA plain note.\n\nSecond paragraph.\n\n</hx-note>\n\nNext.'), '> A plain note.\n>\n> Second paragraph.\n\nNext.');
  assert.equal(flat('<hx-note kind="clue">\n\n**The pitch.** Look closer.\n\n</hx-note>'), '> **Clue**\n>\n> **The pitch.** Look closer.');
});

test('comments are removed and presentational tags are unwrapped', () => {
  const output = flat('<!-- 中文说明: author guidance\n\nstill hidden -->\n\nPress <kbd>Tab</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <u>underlined</u>. <!-- inline --> Done.\n\n<details>kept</details>');
  assert.equal(output, 'Press `Tab`, H2O, x2, underlined.  Done.\n\n<details>kept</details>');
});

test('code, diagrams, tables and math pass through untouched', () => {
  const body = [
    '```html',
    '<hx-video src="/media/my-entry/clip.mp4" caption="Opening"></hx-video>',
    '<!-- kept -->',
    '',
    '',
    '<u>kept</u>',
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[Scan] --> B{Missing?}',
    '```',
    '',
    '| Frame | State |',
    '| --- | --- |',
    '| 3 | **Missing** |',
    '',
    'Inline $t = \\frac{d}{v}$ and `<hx-note>` in code.',
    '',
    '- [x] Done',
    '- [ ] Not yet',
  ].join('\n');
  assert.equal(flat(body), body);
});

test('a published entry exports with no site-only blocks or relative media', () => {
  for (const name of ['2026-11-18-missing-frame-prototype']) {
    const source = readFileSync(new URL(`../src/content/posts/${name}.md`, import.meta.url), 'utf8');
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    // Fenced examples legitimately show the raw syntax, so look only outside code fences.
    const prose = flat(body).replace(/^```[\s\S]*?^```$/gm, '');
    assert.doesNotMatch(prose, /<\/?hx-/, name);
    assert.doesNotMatch(prose, /\]\(<?\/media\//, name);
    assert.doesNotMatch(prose, /<!--|[-]/, name);
  }
});
