// Content blocks for Heritage posts. Posts are plain Markdown; richer blocks are written as
// small custom HTML tags (the editor inserts them), and upgraded here in the browser.
//
//   <hx-video src="/media/slug/clip.mp4" poster="..." caption="..."></hx-video>
//   <hx-video youtube="VIDEO_ID" caption="..."></hx-video>
//   <hx-gallery> ![alt](/media/a.png) ![alt](/media/b.png) </hx-gallery>
//   <hx-compare before="/media/a.png" after="/media/b.png" before-label="Blockout" after-label="Lit"></hx-compare>
//   <hx-model src="/media/slug/key.glb" alt="The brass key"></hx-model>
//   <hx-blueprint src="https://blueprintue.com/render/abc123/"></hx-blueprint>
//   <hx-build version="0.3.1" changelist="1482" date="2026-11-10"> - list of changes </hx-build>
//   <hx-note kind="clue"> text </hx-note>
//   ```mermaid fences and $math$ need no tag.

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const once = (host, build) => { if (!host.dataset.ready) { host.dataset.ready = '1'; build(); } };
const caption = host => (host.getAttribute('caption') ? [el('figcaption', { textContent: host.getAttribute('caption') })] : []);

customElements.define('hx-video', class extends HTMLElement {
  connectedCallback() {
    once(this, () => {
      const youtube = this.getAttribute('youtube');
      let media;
      if (youtube && /^[\w-]{6,20}$/.test(youtube)) {
        media = el('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${youtube}`, loading: 'lazy', allowFullscreen: true,
          title: this.getAttribute('caption') || 'Video', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture',
        });
      } else {
        media = el('video', { src: this.getAttribute('src') || '', controls: true, preload: 'metadata', playsInline: true });
        if (this.getAttribute('poster')) media.poster = this.getAttribute('poster');
        if (this.hasAttribute('loop')) Object.assign(media, { loop: true, muted: true, autoplay: true });
      }
      this.replaceChildren(el('figure', {}, el('div', { className: 'hx-frame' }, media), ...caption(this)));
    });
  }
});

let lightbox;
const openLightbox = image => {
  if (!lightbox) {
    lightbox = el('dialog', { className: 'hx-lightbox' }, el('img'), el('p'));
    lightbox.addEventListener('click', () => lightbox.close());
    document.body.append(lightbox);
  }
  Object.assign(lightbox.querySelector('img'), { src: image.currentSrc || image.src, alt: image.alt });
  lightbox.querySelector('p').textContent = image.alt;
  lightbox.showModal();
};

customElements.define('hx-gallery', class extends HTMLElement {
  connectedCallback() {
    once(this, () => {
      const images = [...this.querySelectorAll('img')];
      const grid = el('div', { className: 'hx-gallery-grid' });
      for (const image of images) {
        image.loading = 'lazy';
        const button = el('button', { type: 'button', ariaLabel: `Enlarge: ${image.alt || 'image'}` }, image);
        button.addEventListener('click', () => openLightbox(image));
        grid.append(button);
      }
      this.replaceChildren(el('figure', {}, grid, ...caption(this)));
    });
  }
});

customElements.define('hx-compare', class extends HTMLElement {
  connectedCallback() {
    once(this, () => {
      const before = this.getAttribute('before-label') || 'Before', after = this.getAttribute('after-label') || 'After';
      const frame = el('div', { className: 'hx-compare-frame' },
        el('img', { src: this.getAttribute('after') || '', alt: after, loading: 'lazy' }),
        el('img', { src: this.getAttribute('before') || '', alt: before, loading: 'lazy', className: 'hx-compare-top' }),
        el('span', { className: 'hx-compare-label', textContent: before }),
        el('span', { className: 'hx-compare-label hx-compare-label-end', textContent: after }));
      const range = el('input', { type: 'range', min: 0, max: 100, value: 50, ariaLabel: `Reveal ${before} or ${after}` });
      const set = () => frame.style.setProperty('--pos', `${range.value}%`);
      range.addEventListener('input', set); set();
      frame.append(range);
      this.replaceChildren(el('figure', {}, frame, ...caption(this)));
    });
  }
});

customElements.define('hx-model', class extends HTMLElement {
  connectedCallback() {
    once(this, async () => {
      const frame = el('div', { className: 'hx-frame hx-model-frame' }, el('p', { textContent: 'Loading model…' }));
      this.replaceChildren(el('figure', {}, frame, ...caption(this)));
      try {
        await import('@google/model-viewer');
        const viewer = document.createElement('model-viewer');
        viewer.setAttribute('src', this.getAttribute('src') || '');
        viewer.setAttribute('alt', this.getAttribute('alt') || '3D model');
        for (const flag of ['camera-controls', 'auto-rotate', 'touch-action']) viewer.setAttribute(flag, flag === 'touch-action' ? 'pan-y' : '');
        frame.replaceChildren(viewer);
      } catch { frame.firstChild.textContent = 'This model could not be loaded.'; }
    });
  }
});

customElements.define('hx-blueprint', class extends HTMLElement {
  connectedCallback() {
    once(this, () => {
      const src = this.getAttribute('src') || '';
      let allowed = false;
      try { allowed = new URL(src).hostname === 'blueprintue.com'; } catch { /* not a URL */ }
      const body = allowed
        ? el('iframe', { src, loading: 'lazy', title: this.getAttribute('caption') || 'Blueprint graph', allowFullscreen: true })
        : el('p', { textContent: 'Blueprint embeds must come from blueprintue.com.' });
      this.replaceChildren(el('figure', {}, el('div', { className: 'hx-frame hx-blueprint-frame' }, body), ...caption(this)));
    });
  }
});

customElements.define('hx-build', class extends HTMLElement {
  connectedCallback() {
    once(this, () => {
      const facts = [['Build', 'version'], ['Changelist', 'changelist'], ['Date', 'date']]
        .filter(([, attr]) => this.getAttribute(attr))
        .map(([label, attr]) => el('span', {}, el('b', { textContent: label }), ` ${this.getAttribute(attr)}`));
      this.prepend(el('header', {}, ...facts));
    });
  }
});

const diagrams = document.querySelectorAll('pre.mermaid');
if (diagrams.length) {
  import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false, theme: 'base', fontFamily: 'EB Garamond, Georgia, serif',
      themeVariables: { primaryColor: '#efe4cc', primaryBorderColor: '#6b5a45', primaryTextColor: '#2a241c', lineColor: '#6b5a45', secondaryColor: '#dfe5da', tertiaryColor: '#f6efdf' },
    });
    mermaid.run({ nodes: diagrams });
  });
}
