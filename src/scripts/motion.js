// Scroll and pointer motion. All of it is decoration; the styles live under "Motion" in global.css.
// With reduced motion the script does nothing and the page stays still and fully visible.
window.__motion = true;
const root = document.documentElement;
const clamp = value => Math.min(1, Math.max(0, value));

if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  root.classList.remove('js');
} else {
  // Blocks inside an entry come to rest as they are reached. Only those below the first screen are hidden,
  // so nothing the reader can already see disappears.
  const blocks = '.prose > :is(h2, h3, figure, pre, table, blockquote, hx-video, hx-gallery, hx-compare, hx-model, hx-blueprint, hx-build, hx-note)';
  for (const block of document.querySelectorAll(blocks)) {
    if (block.getBoundingClientRect().top > innerHeight) block.setAttribute('data-reveal', '');
  }

  const observer = new IntersectionObserver(entries => {
    let order = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.setProperty('--delay', `${order++ * 0.12}s`); // things arriving together arrive in turn
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  for (const target of document.querySelectorAll('[data-reveal]')) observer.observe(target);

  // The thread draws itself down the page, and an entry shows how far through it you are.
  const threads = [...document.querySelectorAll('.thread')];
  const letter = document.querySelector('.letter');
  let bar;
  if (letter) {
    bar = document.createElement('div');
    bar.className = 'progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);
  }
  let queued = false;
  const frame = () => {
    queued = false;
    for (const thread of threads) {
      const box = thread.getBoundingClientRect();
      thread.style.setProperty('--drawn', clamp((innerHeight * 0.8 - box.top) / box.height).toFixed(4));
    }
    if (bar) {
      const box = letter.getBoundingClientRect();
      const span = box.height - innerHeight * 0.6;
      bar.style.setProperty('--read', (span > 0 ? clamp(-box.top / span) : 1).toFixed(4));
    }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  frame();

  // Cards lean toward the pointer.
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    for (const card of document.querySelectorAll('[data-tilt]')) {
      card.addEventListener('pointermove', event => {
        const box = card.getBoundingClientRect();
        card.classList.add('is-tilting');
        card.style.setProperty('--ry', `${(((event.clientX - box.left) / box.width) - 0.5) * 5}deg`);
        card.style.setProperty('--rx', `${(0.5 - ((event.clientY - box.top) / box.height)) * 5}deg`);
      });
      card.addEventListener('pointerleave', () => {
        card.classList.remove('is-tilting');
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      });
    }
  }
}
