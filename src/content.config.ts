import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { DISCIPLINE_KEYS } from './lib/disciplines';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts', generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    entryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/).optional(),
    title: z.string().min(1),
    date: z.coerce.date(),
    discipline: z.enum(DISCIPLINE_KEYS),
    authors: z.array(z.string()).min(1).max(20),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    visibility: z.literal('public').default('public'),
    draft: z.boolean().default(false),
  }).strict(),
});

// Generated from verified platform identities. Only the two existing demonstration profiles
// may omit Discord, and the shared policy restricts their use to unchanged sample articles.
const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/authors' }),
  schema: z.object({
    name: z.string().min(1),
    avatar: z.string().url().optional(),
    discord: z.string().regex(/^\d{15,22}$/).optional(),
    github: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
    githubId: z.number().int().positive().optional(),
    generated: z.boolean().optional(),
    active: z.boolean().default(true),
    demo: z.boolean().default(false),
    role: z.string().optional(),
    discipline: z.enum(DISCIPLINE_KEYS).optional(),
    bio: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
  }).strict().refine(data => data.demo || (data.generated && data.discord), { message: 'Authors must register with /devlog-access register.' })
    .refine(data => !data.github || data.githubId, { message: 'GitHub links require a verified account ID.' }),
});

export const collections = { posts, authors };
