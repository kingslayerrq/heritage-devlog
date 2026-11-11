import type { APIContext } from 'astro';
import { publicPosts, postAuthors, url, SITE } from '../lib/site';
import { DISCIPLINES } from '../lib/disciplines';

// JSON Feed 1.1. Automations (Discord, Notion mirrors, etc.) can read every public post from here,
// including its raw Markdown in `content_text`.
export async function GET({ site }: APIContext) {
  const absolute = (path: string) => new URL(url(path), site).href;
  const posts = await Promise.all((await publicPosts()).map(async post => Object.assign(post, { people: await postAuthors(post) })));
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: SITE.title,
    description: SITE.description,
    home_page_url: absolute('/'),
    feed_url: absolute('/feed.json'),
    items: posts.map(post => ({
      id: post.id,
      url: absolute(`/posts/${post.id}/`),
      title: post.data.title,
      summary: post.data.summary,
      image: post.data.cover ? absolute(post.data.cover) : undefined,
      date_published: post.data.date.toISOString(),
      authors: post.people.map(author => ({
        name: author.data.name,
        url: absolute(`/people/${author.id}/`),
        avatar: author.data.avatar ? absolute(author.data.avatar) : undefined,
      })),
      tags: post.data.tags,
      _heritage: { discipline: post.data.discipline, discipline_name: DISCIPLINES[post.data.discipline].name, author_ids: post.data.authors },
      content_text: post.body ?? '',
    })),
  };
  return new Response(JSON.stringify(feed, null, 2), { headers: { 'Content-Type': 'application/feed+json; charset=utf-8' } });
}
