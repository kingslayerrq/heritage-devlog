import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { DISCIPLINE_KEYS } from './lib/disciplines';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** Exactly one discipline per entry. */
    discipline: z.enum(DISCIPLINE_KEYS),
    /** Author ids: file names in src/content/authors, without ".json". First is the lead author. */
    authors: z.array(z.string()).default([]),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    visibility: z.enum(['public', 'internal']).default('public'),
    draft: z.boolean().default(false),
  }),
});

// One file per person, named by a slug (not the Discord id, so an id is only public when its owner opts in).
const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/authors' }),
  schema: z.object({
    name: z.string(),
    role: z.string().optional(),
    discipline: z.enum(DISCIPLINE_KEYS).optional(),
    bio: z.string().optional(),
    /** Path under public/, e.g. /media/authors/slug.webp. Copied into the repo at publish time. */
    avatar: z.string().optional(),
    /** Discord user id. Present only when the author chose to show a link to their Discord profile. */
    discord: z.string().regex(/^\d{15,22}$/).optional(),
    /** GitHub account that owns this profile and the entries signed with it. Not shown on the site. */
    github: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
  }),
});

export const collections = { posts, authors };
