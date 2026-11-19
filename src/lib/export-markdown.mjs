// Turns a published entry into portable Markdown for "Download Markdown" / "Copy for Notion".
// The site's own blocks (<hx-*>) mean nothing elsewhere, so they are flattened to plain Markdown,
// and /media/ paths become absolute links to the published site. Code, diagrams, tables and
// math are left exactly as written. This is a one-way export, not a submission format.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import { parseFragment } from 'parse5';

const parser = unified().use(remarkParse).use(remarkMath);

// One HTML comment or one tag, with quoted attribute values allowed to contain ">".
const TOKEN = /<!--[\s\S]*?-->|<\/?[A-Za-z][\w-]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
// Private-use markers for the span of a note, turned into a blockquote once every edit is applied.
const NOTE_OPEN = '', NOTE_KIND_END = '', NOTE_CLOSE = '';
const MARKERS = /[-]/g;
const DROPPED_TAGS = new Set(['u', 'sub', 'sup']);

const escapeText = value => String(value).replace(/[\\*_[\]`]/g, '\\$&');
const emphasis = value => (value ? `*${escapeText(value)}*` : '');
const blocks = (...parts) => parts.filter(Boolean).join('\n\n');

function attributes(tag) {
  const element = parseFragment(tag).childNodes.find(node => node.attrs);
  return Object.fromEntries((element?.attrs ?? []).map(attr => [attr.name, attr.value]));
}

function visit(node, callback, parent = null) {
  callback(node, parent);
  if (Array.isArray(node.children)) for (const child of node.children) visit(child, callback, node);
}

/**
 * Flatten an entry body. `mediaBase` is the published site root without a trailing slash,
 * for example "https://example.org/heritage-devlog".
 */
export function flattenBody(body, { mediaBase = '' } = {}) {
  const source = String(body ?? '').replace(/\r\n?/g, '\n').replace(MARKERS, '');
  const absolute = path => (typeof path === 'string' && path.startsWith('/media/') ? mediaBase + path : path ?? '');
  const edits = [];
  const insertBase = offset => edits.push({ start: offset, end: offset, text: mediaBase });
  const open = [];

  const openTag = (name, attrs) => {
    const caption = attrs.caption ?? '';
    switch (name) {
      case 'hx-gallery':
        open.push({ name, caption });
        return '';
      case 'hx-compare': {
        const before = attrs['before-label'] || 'Before', after = attrs['after-label'] || 'After';
        return blocks(
          `**${escapeText(before)}**`, `![${escapeText(before)}](${absolute(attrs.before)})`,
          `**${escapeText(after)}**`, `![${escapeText(after)}](${absolute(attrs.after)})`,
          emphasis(caption));
      }
      case 'hx-video':
        if (attrs.youtube && /^[\w-]{6,20}$/.test(attrs.youtube)) return blocks(`https://www.youtube.com/watch?v=${attrs.youtube}`, emphasis(caption));
        return blocks(
          attrs.poster && `![${escapeText(caption || 'Video poster')}](${absolute(attrs.poster)})`,
          `[Video: ${escapeText(caption || 'watch the clip')}](${absolute(attrs.src)})`);
      case 'hx-model':
        return blocks(`[3D model: ${escapeText(attrs.alt || 'view the model')}](${absolute(attrs.src)})`, emphasis(caption));
      case 'hx-blueprint':
        return `[Blueprint: ${escapeText(caption || 'view the graph')}](${attrs.src ?? ''})`;
      case 'hx-build': {
        const facts = [['Build', 'version'], ['Changelist', 'changelist']].filter(([, key]) => attrs[key]).map(([label, key]) => `${label} ${escapeText(attrs[key])}`);
        const head = facts.length ? [`**${facts[0]}**`, ...facts.slice(1)] : ['**Build notes**'];
        return [...head, ...(attrs.date ? [escapeText(attrs.date)] : [])].join(' · ');
      }
      case 'hx-note':
        return NOTE_OPEN + (attrs.kind === 'clue' ? 'clue' : '') + NOTE_KIND_END;
      default:
        return null;
    }
  };

  const closeTag = name => {
    if (name === 'hx-gallery') {
      const index = open.findLastIndex(entry => entry.name === name);
      return index < 0 ? '' : emphasis(open.splice(index, 1)[0].caption);
    }
    if (name === 'hx-note') return NOTE_CLOSE;
    return name.startsWith('hx-') ? '' : null;
  };

  visit(parser.parse(source), (node, parent) => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const slice = source.slice(start, end);

    if (node.type === 'html') {
      for (const match of slice.matchAll(TOKEN)) {
        const token = match[0];
        let text;
        if (token.startsWith('<!--')) text = '';
        else {
          const name = /^<\/?([A-Za-z][\w-]*)/.exec(token)[1].toLowerCase();
          const closing = token.startsWith('</');
          if (DROPPED_TAGS.has(name)) text = '';
          else if (name === 'kbd') text = '`';
          else text = closing ? closeTag(name) : openTag(name, attributes(token));
        }
        if (text !== null) edits.push({ start: start + match.index, end: start + match.index + token.length, text, block: parent?.type === 'root' });
      }
    } else if (node.type === 'image' && node.url.startsWith('/media/')) {
      const at = /\]\(\s*<?(?=\/media\/)/.exec(slice);
      if (at) insertBase(start + at.index + at[0].length);
    } else if (node.type === 'link' && node.url.startsWith('/media/')) {
      const from = (node.children.at(-1)?.position?.end.offset ?? start) - start;
      const at = /\]\(\s*<?(?=\/media\/)/.exec(slice.slice(from));
      if (at) insertBase(start + from + at.index + at[0].length);
    } else if (node.type === 'definition' && node.url.startsWith('/media/')) {
      const at = /^\[[^\]]*\]:\s*<?(?=\/media\/)/.exec(slice);
      if (at) insertBase(start + at[0].length);
    } else if (node.type === 'paragraph') {
      // Images that share a paragraph (a gallery) each get their own block, so every one survives an import.
      const onlyImages = node.children.every(child => child.type === 'image' || child.type === 'break' || (child.type === 'text' && !child.value.trim()));
      if (onlyImages && node.children.filter(child => child.type === 'image').length > 1) {
        node.children.forEach((child, index) => {
          if (child.type === 'image' || index === 0 || index === node.children.length - 1) return;
          edits.push({ start: child.position.start.offset, end: child.position.end.offset, text: '\n\n' });
        });
      }
    }
  });

  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let output = '', cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    output += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
    // A whole-line tag or comment that leaves nothing behind takes its trailing blank lines with it.
    if (edit.block && edit.text === '' && (edit.start === 0 || source[edit.start - 1] === '\n')) {
      const gap = /^[ \t]*\n+/.exec(source.slice(cursor));
      if (gap) cursor += gap[0].length;
    }
  }
  output += source.slice(cursor);

  output = output.replace(new RegExp(`${NOTE_OPEN}([a-z]*)${NOTE_KIND_END}([\\s\\S]*?)${NOTE_CLOSE}`, 'g'), (_, kind, inner) => {
    const lines = [...(kind === 'clue' ? ['**Clue**', ''] : []), ...inner.trim().split('\n')];
    return lines.map(line => (line.trim() ? `> ${line}` : '>')).join('\n');
  });
  return output.replace(MARKERS, '').trim();
}

/** The full export: a title, the entry's facts and a link back, then the flattened body. */
export function exportMarkdown({ body, title, summary, date, disciplineName, authors = [], tags = [], cover, coverAlt, pageUrl, mediaBase = '' }) {
  const facts = [date && `**${date}**`, disciplineName, authors.length && `by ${authors.join(', ')}`, tags.length && `Tags: ${tags.join(', ')}`].filter(Boolean);
  const coverUrl = cover && (cover.startsWith('/') ? mediaBase + cover : cover);
  return blocks(
    `# ${title}`,
    summary && `> ${summary.trim().replace(/\s*\n\s*/g, ' ')}`,
    facts.join(' · '),
    pageUrl && `Originally published at <${pageUrl}>`,
    coverUrl && `![${escapeText(coverAlt ?? '')}](${coverUrl})`,
    flattenBody(body, { mediaBase }),
  ) + '\n';
}
