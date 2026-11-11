import { getCollection, type CollectionEntry } from 'astro:content';

export const SITE = {
  title: 'Heritage',
  tagline: 'what the house kept',
  description: 'A development journal for Heritage, a puzzle game about investigating an old mansion.',
  /** Server invite link. Shown as the way to reach an author who has no personal links. Leave empty to hide. */
  discordInvite: '',
};

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
/** Prefix an internal path ("/posts/x/", "/media/x.png") with the deploy base path. */
export const url = (path: string) => (/^https?:\/\//.test(path) ? path : base + (path.startsWith('/') ? path : `/${path}`));

export type Post = CollectionEntry<'posts'>;
export type Author = CollectionEntry<'authors'>;

/** Public, non-draft posts, newest first. Internal posts never belong in this repo; this is a second guard. */
export async function publicPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => data.visibility === 'public' && !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** "Entry N" for a post: 1 is the oldest public entry. */
export async function entryNumber(post: Post): Promise<number> {
  const posts = await publicPosts();
  return posts.length - posts.findIndex(other => other.id === post.id);
}

export async function allAuthors(): Promise<Author[]> {
  return (await getCollection('authors')).sort((a, b) => a.data.name.localeCompare(b.data.name));
}

/** The authors of a post, in the order written. An unknown id fails the build so a byline is never silently lost. */
export async function postAuthors(post: Post): Promise<Author[]> {
  const byId = new Map((await getCollection('authors')).map(author => [author.id, author]));
  return post.data.authors.map(id => {
    const author = byId.get(id);
    if (!author) throw new Error(`Entry "${post.id}" names author "${id}", but src/content/authors/${id}.json does not exist.`);
    return author;
  });
}

/** Ways to reach an author: their opted-in Discord profile, then their own links, else the server invite. */
export function authorLinks(author: Author): { label: string; url: string }[] {
  const links = [
    ...(author.data.discord ? [{ label: 'Discord', url: `https://discord.com/users/${author.data.discord}` }] : []),
    ...author.data.links,
  ];
  if (links.length === 0 && SITE.discordInvite) links.push({ label: 'Find us on Discord', url: SITE.discordInvite });
  return links;
}

export const longDate = (date: Date) =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
export const tagSlug = (tag: string) => tag.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
/** A CSS-safe name shared by an entry's card and its full page, so one morphs into the other between pages. */
export const transitionName = (id: string) => `e-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
