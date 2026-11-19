import type { APIContext } from 'astro';
import { publicPosts, postAuthors, url, longDate, type Post } from '../../lib/site';
import { DISCIPLINES } from '../../lib/disciplines';
import { exportMarkdown } from '../../lib/export-markdown.mjs';

// A portable Markdown copy of each public entry, at /posts/<id>.md beside its page.
// Private and draft entries have no page, so they have no export either.
export async function getStaticPaths() {
  return (await publicPosts()).map(post => ({ params: { slug: post.id }, props: { post } }));
}

export async function GET({ props, site }: APIContext) {
  const post = props.post as Post;
  const absolute = (path: string) => new URL(url(path), site).href;
  const authors = await postAuthors(post);
  const markdown = exportMarkdown({
    body: post.body ?? '',
    title: post.data.title,
    summary: post.data.summary,
    date: longDate(post.data.date),
    disciplineName: DISCIPLINES[post.data.discipline].name,
    authors: authors.map(author => author.data.name),
    tags: post.data.tags,
    cover: post.data.cover,
    coverAlt: post.data.coverAlt,
    pageUrl: absolute(`/posts/${post.id}/`),
    mediaBase: absolute('/').replace(/\/$/, ''),
  });
  return new Response(markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
