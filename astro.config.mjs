import { defineConfig, passthroughImageService } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkHeritage } from './src/lib/remark-heritage.mjs';
import { privateMediaIntegration } from './src/lib/private-media.mjs';

// Project pages live at https://<owner>.github.io/<repo>/.
// Override with SITE_URL / BASE_PATH (e.g. BASE_PATH=/ for a custom domain).
const site = process.env.SITE_URL || 'https://kingslayerrq.github.io';
const base = (process.env.BASE_PATH || '/heritage-devlog').replace(/\/$/, '');

export default defineConfig({
  site,
  base: base || '/',
  trailingSlash: 'always',
  // Media that only private or draft entries use is removed from the built site.
  integrations: [privateMediaIntegration()],
  // Author media is served unchanged. Never decode untrusted assets through Sharp.
  image: { service: passthroughImageService(), domains: [], remotePatterns: [] },
  markdown: {
    remarkPlugins: [remarkMath, [remarkHeritage, { base }]],
    rehypePlugins: [rehypeKatex],
    shikiConfig: { theme: 'vitesse-light', wrap: true },
  },
});
