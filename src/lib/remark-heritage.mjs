// Markdown tweaks for the Heritage devlog:
//  - prefixes the site base path onto /media/... URLs (images, links, raw HTML attributes)
//  - turns ```mermaid fences into <pre class="mermaid"> so the browser can draw them
const MEDIA_ATTR = /\b(src|href|poster|before|after)=(["'])\/media\//g;
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function remarkHeritage({ base = '' } = {}) {
  const walk = node => {
    if ((node.type === 'image' || node.type === 'link') && typeof node.url === 'string' && node.url.startsWith('/media/')) {
      node.url = base + node.url;
    } else if (node.type === 'html') {
      node.value = node.value.replace(MEDIA_ATTR, (_, attr, quote) => `${attr}=${quote}${base}/media/`);
    } else if (node.type === 'code' && node.lang === 'mermaid') {
      node.type = 'html';
      node.value = `<pre class="mermaid">${escapeHtml(node.value)}</pre>`;
      delete node.lang;
      delete node.meta;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return tree => walk(tree);
}
