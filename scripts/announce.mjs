// Posts a Discord message for each newly added public entry.
// Usage (CI): node scripts/announce.mjs <before-sha> <after-sha>
// Needs DISCORD_DEVLOG_WEBHOOK; SITE_URL and BASE_PATH mirror astro.config.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const webhook = process.env.DISCORD_DEVLOG_WEBHOOK;
const [before, after = 'HEAD'] = process.argv.slice(2);
if (!webhook) { console.log('DISCORD_DEVLOG_WEBHOOK is not set; skipping announcement.'); process.exit(0); }
if (!before || /^0+$/.test(before)) { console.log('No previous commit to compare against; skipping announcement.'); process.exit(0); }

const site = (process.env.SITE_URL || 'https://kingslayerrq.github.io').replace(/\/$/, '');
const base = (process.env.BASE_PATH || '/heritage-devlog').replace(/\/$/, '');
const absolute = path => (/^https?:\/\//.test(path) ? path : site + base + path);

const added = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', before, after, '--', 'src/content/posts'], { encoding: 'utf8' })
  .split('\n').filter(file => file.endsWith('.md'));

// Minimal front matter reader: flat `key: value` pairs and `[a, b]` lists, which is all the editor writes.
function frontMatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else value = value.replace(/^["']|["']$/g, '');
    data[match[1]] = value;
  }
  return data;
}

// Author ids resolve to display names through src/content/authors/<id>.json.
function authorNames(ids) {
  return (Array.isArray(ids) ? ids : []).map(id => {
    try { return JSON.parse(readFileSync(`src/content/authors/${id}.json`, 'utf8')).name; } catch { return null; }
  }).filter(Boolean).join(', ');
}
const title = text => text.charAt(0).toUpperCase() + text.slice(1);

let failed = false;
for (const file of added) {
  const data = frontMatter(readFileSync(file, 'utf8'));
  if (data.draft === 'true' || (data.visibility && data.visibility !== 'public')) continue;
  const slug = file.replace(/^src\/content\/posts\//, '').replace(/\.md$/, '');
  const names = authorNames(data.authors);
  const labels = [data.discipline ? title(String(data.discipline)) : null, ...(Array.isArray(data.tags) ? data.tags : [])].filter(Boolean);
  const embed = {
    title: String(data.title || basename(slug)).slice(0, 256),
    url: absolute(`/posts/${slug}/`),
    description: String(data.summary || '').slice(0, 2000) || undefined,
    color: 0x8a4530,
    author: names ? { name: names.slice(0, 256) } : undefined,
    footer: labels.length ? { text: labels.join(' · ').slice(0, 2048) } : undefined,
    // Discord cannot display SVG images in embeds.
    image: data.cover && !/\.svg$/i.test(data.cover) ? { url: absolute(data.cover) } : undefined,
    timestamp: new Date().toISOString(),
  };
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'A new entry was added to the Heritage journal.', embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (response.ok) console.log(`Announced ${slug}`);
  else { failed = true; console.error(`Discord rejected ${slug}: ${response.status}`); }
}
if (!added.length) console.log('No new entries in this push.');
process.exit(failed ? 1 : 0);
