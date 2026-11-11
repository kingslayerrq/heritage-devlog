import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkHeritage } from './src/lib/remark-heritage.mjs';

// Project pages live at https://<owner>.github.io/<repo>/.
// Override with SITE_URL / BASE_PATH (e.g. BASE_PATH=/ for a custom domain).
const site = process.env.SITE_URL || 'https://kingslayerrq.github.io';
const base = (process.env.BASE_PATH || '/heritage-devlog').replace(/\/$/, '');

export default defineConfig({
  site,
  base: base || '/',
  trailingSlash: 'always',
  markdown: {
    remarkPlugins: [remarkMath, [remarkHeritage, { base }]],
    rehypePlugins: [rehypeKatex],
    shikiConfig: { theme: 'vitesse-light', wrap: true },
  },
});
