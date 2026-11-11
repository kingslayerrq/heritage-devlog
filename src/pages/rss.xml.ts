import type { APIContext } from 'astro';
import { publicPosts, url, SITE } from '../lib/site';
import { DISCIPLINES } from '../lib/disciplines';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET({ site }: APIContext) {
  const absolute = (path: string) => new URL(url(path), site).href;
  const items = (await publicPosts()).map(post => `
    <item>
      <title>${esc(post.data.title)}</title>
      <link>${absolute(`/posts/${post.id}/`)}</link>
      <guid>${absolute(`/posts/${post.id}/`)}</guid>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
      <category>${esc(DISCIPLINES[post.data.discipline].name)}</category>
      <description>${esc(post.data.summary ?? '')}</description>
    </item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(SITE.title)}</title>
  <link>${absolute('/')}</link>
  <description>${esc(SITE.description)}</description>${items}
</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
