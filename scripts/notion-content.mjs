// Deterministic Notion block conversion. This module never writes files or publishes.
import { createHash } from 'node:crypto';
import { extname, basename } from 'node:path';
import { isUtf8 } from 'node:buffer';
import { parseFragment } from 'parse5';
import { DISCIPLINES, isAuthorContentPath } from './content-policy.mjs';

export const NOTION_CONTENT_LIMITS = Object.freeze({ document: 256 * 1024, file: 25 * 1024 * 1024, total: 100 * 1024 * 1024, assets: 20, blocks: 500, depth: 12 });
const uuid = value => typeof value === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value);
const compact = value => value.replace(/-/g, '').toLowerCase();
const html = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const markdown = value => html(value).replace(/[\\`*_[\]{}()#+.!|>~$-]/g, '\\$&');
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeText = value => typeof value === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

export class NotionContentError extends Error {
  constructor(issue) { super(issue.message); this.name = 'NotionContentError'; this.code = issue.code; this.issues = [issue]; }
}

/** Canonical JSON for manifests and provenance; no platform-specific key ordering. */
export function stableStringify(value) {
  const seen = new Set();
  const sort = (item, depth = 0) => {
    if (depth > 64) throw new Error('Document nesting exceeds the supported limit.');
    if (item === null || ['string', 'boolean'].includes(typeof item)) return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!Array.isArray(item) && !plainObject(item)) throw new Error('Only JSON values can be fingerprinted.');
    if (seen.has(item)) throw new Error('Cyclic documents cannot be fingerprinted.');
    seen.add(item);
    const result = Array.isArray(item) ? item.map(child => sort(child, depth + 1)) : Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key], depth + 1)]));
    seen.delete(item); return result;
  };
  return JSON.stringify(sort(value));
}
export const contentDigest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableStringify(value)).digest('hex');

export function trustedNotionAssetUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || /[\x00-\x20\x7f\\]/.test(value)) return false;
    if (['s3.us-west-2.amazonaws.com', 's3-us-west-2.amazonaws.com'].includes(url.hostname)) return url.pathname.startsWith('/secure.notion-static.com/');
    return ['prod-files-secure.s3.us-west-2.amazonaws.com', 'secure.notion-static.com', 'file.notion.so', 'cdn.discordapp.com', 'media.discordapp.net', 'images.unsplash.com', 'raw.githubusercontent.com'].includes(url.hostname);
  } catch { return false; }
}

/** No credentials/cookies, redirects, executable parsing, or arbitrary network hosts. */
export async function downloadNotionAsset(url, { maxBytes = NOTION_CONTENT_LIMITS.file, fetch = globalThis.fetch } = {}) {
  if (!trustedNotionAssetUrl(url) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > NOTION_CONTENT_LIMITS.file) throw new Error('The media source is not an approved HTTPS host. Upload the file to Notion.');
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: '*/*' } });
    if (response.status !== 200 || !response.body) throw new Error('Media download did not return a file.');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('Media size exceeds the limit.');
    const parts = []; let size = 0;
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > maxBytes) throw new Error('Media size exceeds the limit.');
      parts.push(Buffer.from(part));
    }
    if (!size) throw new Error('Media is empty.');
    return { bytes: Buffer.concat(parts, size), contentType: response.headers.get('content-type')?.split(';')[0] || '' };
  } catch {
    // Fetch errors and upstream response bodies can contain temporary signed URLs.
    throw new Error('Media could not be downloaded within the size/time limits. Refresh the Notion file and retry.');
  }
}

function svgSafe(bytes) {
  if (!isUtf8(bytes)) return false;
  const text = bytes.toString();
  if (/<!doctype|<!entity|<\?xml-stylesheet/i.test(text)) return false;
  const allowed = new Set(['svg','g','defs','title','desc','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','linearGradient','radialGradient','stop','clipPath','mask']);
  let valid = true, found = false;
  const walk = node => {
    if (node.tagName) {
      found ||= node.tagName === 'svg'; valid &&= allowed.has(node.tagName);
      for (const attr of node.attrs || []) {
        if (/^on/i.test(attr.name) || ['href','src','style'].includes(attr.name) || attr.prefix === 'xlink') valid = false;
        if (/url\s*\(/i.test(attr.value) && !/^url\(\s*#[A-Za-z0-9_-]+\s*\)$/.test(attr.value)) valid = false;
      }
    }
    (node.childNodes || []).forEach(walk);
  };
  walk(parseFragment(text)); return valid && found;
}

function fileExtension(bytes, hint) {
  const start = bytes.subarray(0, 16), ascii = start.toString('ascii');
  if (start.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (start[0] === 255 && start[1] === 216 && start[2] === 255) return '.jpg';
  if (/^GIF8[79]a/.test(ascii)) return '.gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8,12) === 'WEBP') return '.webp';
  if (ascii.slice(4,8) === 'ftyp') return ['avif','avis'].includes(ascii.slice(8,12)) ? '.avif' : '.mp4';
  if (start.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return '.webm';
  if (ascii.startsWith('%PDF-')) return '.pdf';
  if (start[0] === 80 && start[1] === 75 && [3,5,7].includes(start[2]) && [4,6,8].includes(start[3])) return '.zip';
  if (ascii.startsWith('glTF')) {
    if (bytes.length < 20 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a || bytes.readUInt32LE(12) > bytes.length - 20) return null;
    try {
      const data = JSON.parse(bytes.subarray(20,20 + bytes.readUInt32LE(12)).toString());
      if (data.asset?.version !== '2.0' || [...(data.buffers || []), ...(data.images || [])].some(item => item.uri !== undefined && !/^data:(?:image\/(?:png|jpeg)|application\/octet-stream);base64,[A-Za-z0-9+/=]+$/.test(item.uri))) return null;
      return '.glb';
    } catch { return null; }
  }
  if (hint === '.svg') return svgSafe(bytes) ? '.svg' : null;
  if (hint === '.txt' && isUtf8(bytes) && !bytes.includes(0)) return '.txt';
  return null;
}

/** Compile an already authorized, frozen snapshot; the caller owns authorization and Git writes. */
export async function compileNotionSnapshot(snapshot, { download = downloadNotionAsset } = {}) {
  const warnings = [], assets = [], byUrl = new Map(), byPath = new Map();
  let blocksSeen = 0, downloaded = 0, requests = 0, textBytes = 0;
  const path = typeof snapshot?.path === 'string' ? snapshot.path : '';
  const sourceUrl = block => uuid(snapshot?.pageId) ? `https://www.notion.so/${compact(snapshot.pageId)}${uuid(block?.id) ? '#' + compact(block.id) : ''}` : undefined;
  const issue = (severity, code, message, block, fix) => ({ severity, code: 'notion.' + code, path, line: 1, message, ...(sourceUrl(block) ? { sourceUrl: sourceUrl(block) } : {}), ...(fix ? { fix: fix + (sourceUrl(block) ? ' Source: ' + sourceUrl(block) : '') } : {}) });
  const fail = (code, message, block, fix = 'Correct this Notion block and request publication again.') => { throw new NotionContentError(issue('error', code, message, block, fix)); };
  const warn = (code, message, block, fix) => { if (!warnings.some(item => item.code === 'notion.' + code && item.sourceUrl === sourceUrl(block))) warnings.push(issue('warning', code, message, block, fix)); };
  if (!plainObject(snapshot) || !uuid(snapshot.pageId) || !plainObject(snapshot.metadata) || !Array.isArray(snapshot.blocks)) fail('snapshot', 'The Notion submission is incomplete.');
  if (!/^src\/content\/posts\/\d{4}-\d{2}-\d{2}-[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\.md$/u.test(path) || !isAuthorContentPath(path)) fail('path', 'The article path is invalid.');
  const data = snapshot.metadata;
  if (Object.keys(data).some(key => !['title','date','discipline','authors','summary','tags'].includes(key))) fail('metadata', 'The submission contains unsupported article fields.');
  if (!safeText(data.title) || !data.title.trim() || data.title.length > 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || Number.isNaN(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0,10) !== data.date || !DISCIPLINES.includes(data.discipline)) fail('metadata', 'Title, date, or discipline is invalid.');
  if (typeof snapshot.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(snapshot.entryId) || !Array.isArray(data.authors) || !data.authors.length || data.authors.length > 20 || new Set(data.authors).size !== data.authors.length || data.authors.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(id))) fail('metadata', 'The stable entry ID or registered author IDs are invalid.');
  if (data.summary !== undefined && (!safeText(data.summary) || !data.summary.trim())) fail('metadata', 'Summary must be nonempty text when supplied.');
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.length > 30 || data.tags.some(tag => !safeText(tag) || !tag.trim() || tag.length > 80))) fail('metadata', 'Tags must be short text labels.');
  const checkText = (value, block) => {
    if (!safeText(value)) fail('text', 'A text field contains unsupported control characters.', block);
    if ((textBytes += Buffer.byteLength(value)) > NOTION_CONTENT_LIMITS.document) fail('document-size', 'The article text exceeds 256 KiB.', block);
    return value.replace(/\r\n?/g, '\n');
  };
  const link = (value, block) => {
    try {
      const url = new URL(value);
      if (!['https:', 'mailto:'].includes(url.protocol) || url.username || url.password || /[\x00-\x20\x7f\\]/.test(value)) throw new Error();
      if (trustedNotionAssetUrl(value) && url.search) fail('inline-file', 'A temporary file URL cannot be published as a text link.', block, 'Use a Notion image or file block so the file can be copied into the repository.');
      return value;
    } catch (error) { if (error instanceof NotionContentError) throw error; fail('url', 'A link uses an unsupported or unsafe URL.', block, 'Use a complete HTTPS link.'); }
  };
  const rich = (items, block, mode = 'markdown') => {
    if (!Array.isArray(items) || items.length > 1000) fail('rich-text', 'The rich text is incomplete or too large.', block);
    return items.map(item => {
      if (!plainObject(item)) fail('rich-text', 'A rich-text item is invalid.', block);
      if (item.type === 'equation') {
        const expression = checkText(item.equation?.expression, block);
        if (/[\n$]/.test(expression)) fail('equation', 'Inline math contains unsupported delimiters.', block);
        if (mode === 'html') fail('equation-table', 'Inline equations in tables are not supported yet.', block, 'Move the equation into a separate block.');
        return '$' + expression + '$';
      }
      if (item.type !== 'text' || !plainObject(item.text)) fail('rich-text-type', 'This Notion mention or rich-text type is not supported.', block, 'Replace the mention with explicit public text or an HTTPS link.');
      const value = checkText(item.text.content, block), annotations = item.annotations || {};
      if (!value) return '';
      if (!plainObject(annotations) || ['bold','italic','strikethrough','underline','code'].some(key => annotations[key] !== undefined && typeof annotations[key] !== 'boolean')) fail('annotations', 'The text annotations are invalid.', block);
      if (annotations.color && annotations.color !== 'default') warn('color', 'Notion text colors use the website theme instead.', block, 'Use emphasis if the color carries meaning.');
      const escape = mode === 'html' ? html : markdown;
      let result = escape(value).replace(/\n/g, '<br>');
      if (annotations.code) result = '<code>' + escape(value).replace(/\n/g, '<br>') + '</code>';
      for (const [key,tag] of [['bold','strong'],['italic','em'],['strikethrough','s'],['underline','u']]) if (annotations[key]) result = `<${tag}>${result}</${tag}>`;
      if (item.text.link?.url) result = `<a href="${html(link(item.text.link.url, block))}">${result}</a>`;
      return result;
    }).join('');
  };
  const plain = (items, block) => {
    if (!Array.isArray(items) || items.length > 1000 || items.some(item => item?.type !== 'text' || item?.text?.link || Object.entries(item.annotations || {}).some(([key,value]) => key === 'color' ? value !== 'default' : value !== false))) fail('plain-text', 'Code or media captions contain formatting that cannot be preserved here.', block, 'Use plain text for this code block or caption.');
    return items.map(item => checkText(item.text?.content, block)).join('');
  };
  const children = block => {
    const nested = block.children ?? block[block.type]?.children;
    if (block.has_children && !Array.isArray(nested)) fail('children-missing', 'Some child blocks were not retrieved.', block, 'Refresh the submission after the page has finished saving.');
    if (nested !== undefined && !Array.isArray(nested)) fail('children', 'Child blocks are malformed.', block);
    return nested || [];
  };
  const file = async (value, block, kind) => {
    const url = value?.type === 'file' ? value.file?.url : value?.type === 'external' ? value.external?.url : null;
    if (!trustedNotionAssetUrl(url)) fail('media-host', 'This file is not hosted on an approved HTTPS source.', block, 'Upload the file directly to Notion instead of linking an external host.');
    const validKind = extension => !((kind === 'image' && !['.png','.jpg','.gif','.webp','.avif','.svg'].includes(extension)) || (kind === 'video' && !['.mp4','.webm'].includes(extension)) || (kind === 'pdf' && extension !== '.pdf'));
    if (value.name !== undefined && (!safeText(value.name) || value.name.length > 1000)) fail('media-name', 'The file name is invalid.', block);
    if (byUrl.has(url)) {
      const cached = byUrl.get(url);
      if (!validKind(cached.extension)) fail('media-format', 'The file type does not match this Notion block.', block);
      return {...cached,...(value.name ? {filename:basename(value.name)} : {})};
    }
    if (++requests > NOTION_CONTENT_LIMITS.assets) fail('media-count', 'A submission may download at most 20 files.', block);
    let result;
    try { result = await download(url, {maxBytes: NOTION_CONTENT_LIMITS.file}); } catch { fail('media-download', 'The file could not be downloaded safely.', block, 'Refresh the Notion file, check its size, and request publication again.'); }
    if (!(Buffer.isBuffer(result?.bytes) || result?.bytes instanceof Uint8Array)) fail('media-bytes', 'The download did not contain file bytes.', block);
    const bytes = Buffer.from(result.bytes);
    if (!bytes.length || bytes.length > NOTION_CONTENT_LIMITS.file || (downloaded += bytes.length) > NOTION_CONTENT_LIMITS.total) fail('media-size', 'Files are limited to 25 MiB each and 100 MiB per submission.', block);
    let filename;
    try { filename = value.name || decodeURIComponent(new URL(url).pathname.split('/').at(-1)); } catch { fail('media-name', 'The file name is invalid.', block); }
    if (!safeText(filename) || filename.length > 1000) fail('media-name', 'The file name is invalid.', block);
    const extension = fileExtension(bytes, extname(filename || '').toLowerCase());
    if (!extension || !validKind(extension)) fail('media-format', 'The file type is unsupported or does not match this Notion block.', block, 'Use a supported image, MP4/WebM video, self-contained GLB, PDF, ZIP, or TXT file.');
    const path = `public/media/notion-${compact(snapshot.pageId)}/${contentDigest(bytes)}${extension}`;
    if (!byPath.has(path)) { const asset = {path,bytes}; assets.push(asset); byPath.set(path,asset); }
    const output = {url:path.slice('public'.length), filename:basename(filename || ('Attachment' + extension)), extension};
    byUrl.set(url, output); return output;
  };
  const visit = async (block, depth) => {
    if (depth > NOTION_CONTENT_LIMITS.depth || ++blocksSeen > NOTION_CONTENT_LIMITS.blocks) fail('block-limit', 'The page exceeds 500 blocks or 12 nesting levels.', block);
    if (!plainObject(block) || !uuid(block.id) || typeof block.type !== 'string' || !plainObject(block[block.type])) fail('block', 'A Notion block is incomplete.', block);
    if (block.in_trash || block.archived) fail('archived-block', 'The submitted page includes an archived block.', block, 'Refresh the page snapshot before retrying.');
    const value = block[block.type], nested = children(block);
    if (value.color && value.color !== 'default') warn('color', 'Notion block colors use the website theme instead.', block, 'Use emphasis if the color carries meaning.');
    const renderChildren = async () => {
      const parts = [];
      for (const child of nested) parts.push(await visit(child,depth+1));
      return parts.filter(Boolean).join('\n\n');
    };
    const text = () => rich(value.rich_text, block);
    switch (block.type) {
      case 'paragraph': return [text(), await renderChildren()].filter(Boolean).join('\n\n');
      case 'heading_1': case 'heading_2': case 'heading_3': {
        if (value.is_toggleable) warn('expanded-heading', 'A toggle heading is expanded on the website.', block);
        return ['#'.repeat(Number(block.type.at(-1)) + 1) + ' ' + text(), await renderChildren()].filter(Boolean).join('\n\n');
      }
      case 'bulleted_list_item': case 'numbered_list_item': case 'to_do': {
        const prefix = block.type === 'bulleted_list_item' ? '- ' : block.type === 'numbered_list_item' ? '1. ' : `- [${value.checked ? 'x' : ' '}] `;
        if (block.type === 'to_do' && typeof value.checked !== 'boolean') fail('checkbox', 'A checkbox value is invalid.', block);
        const tail = await renderChildren();
        return prefix + text() + (tail ? '\n\n' + tail.split('\n').map(line => ' '.repeat(block.type === 'numbered_list_item' ? 3 : 2) + line).join('\n') : '');
      }
      case 'quote': return [text(),await renderChildren()].filter(Boolean).join('\n\n').split('\n').map(line => '> ' + line).join('\n');
      case 'code': {
        if (nested.length) fail('code-children', 'Code blocks cannot contain child blocks.', block);
        const code = plain(value.rich_text,block), caption = plain(value.caption || [],block);
        const known = {'plain text':'text','c++':'cpp','c#':'csharp','f#':'fsharp','shell':'bash','vb.net':'vb','visual basic':'vb','java/c/c++/c#':'text'};
        let language = known[value.language] || value.language;
        if (typeof language !== 'string' || !/^[a-z0-9+-]{1,40}$/.test(language)) fail('code-language', 'The code language is unsupported.', block, 'Choose a supported code language or Plain Text.');
        const size = Math.max(3, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1));
        const fence = '`'.repeat(size);
        return `${fence}${language}\n${code}\n${fence}` + (caption ? '\n\n' + markdown(caption) : '');
      }
      case 'divider': if (nested.length) fail('children', 'A divider unexpectedly contains children.', block); return '---';
      case 'callout': {
        let icon = '';
        if (value.icon?.type === 'emoji' && safeText(value.icon.emoji)) icon = markdown(value.icon.emoji) + ' ';
        else if (value.icon) warn('callout-icon', 'The callout icon is omitted; its text is retained.', block);
        return '<hx-note>\n\n' + [icon + text(),await renderChildren()].filter(Boolean).join('\n\n') + '\n\n</hx-note>';
      }
      case 'column_list':
        warn('columns', 'Notion columns are shown sequentially on the website.', block, 'Check that the reading order still makes sense.');
        if (nested.some(child => child.type !== 'column')) fail('columns', 'A column layout contains an unexpected child.', block);
        return renderChildren();
      case 'column': return renderChildren();
      case 'table': {
        if (!Number.isInteger(value.table_width) || value.table_width < 1 || value.table_width > 30 || !nested.length || depth >= NOTION_CONTENT_LIMITS.depth || ['has_column_header','has_row_header'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) fail('table', 'The table is empty or too wide.', block);
        const rows = [];
        for (let index = 0; index < nested.length; index++) {
          const row = nested[index];
          if (++blocksSeen > NOTION_CONTENT_LIMITS.blocks || row.type !== 'table_row' || !uuid(row.id) || !Array.isArray(row.table_row?.cells) || row.table_row.cells.length !== value.table_width || children(row).length) fail('table-row', 'A table row is incomplete or has the wrong number of cells.', row);
          rows.push('<tr>' + row.table_row.cells.map((cell,column) => { const tag = (value.has_column_header && index === 0) || (value.has_row_header && column === 0) ? 'th' : 'td'; return `<${tag}>${rich(cell,row,'html')}</${tag}>`; }).join('') + '</tr>');
        }
        return '<table>\n<tbody>\n' + rows.join('\n') + '\n</tbody>\n</table>';
      }
      case 'equation': {
        const expression = checkText(value.expression,block);
        if (!expression.trim() || expression.includes('$$') || nested.length) fail('equation', 'The equation is empty or has unsupported delimiters.', block);
        return '$$\n' + expression + '\n$$';
      }
      case 'bookmark': {
        if (nested.length) fail('children', 'A bookmark unexpectedly contains children.', block);
        const url = link(value.url,block), caption = plain(value.caption || [],block);
        return `<a href="${html(url)}">${html(caption || url)}</a>`;
      }
      case 'image': case 'file': case 'pdf': case 'video': {
        if (nested.length) fail('children', 'A media block unexpectedly contains children.', block);
        const caption = plain(value.caption || [],block);
        if (block.type === 'video' && value.type === 'external') {
          let url; try { url = new URL(value.external?.url); } catch { fail('video', 'The video URL is invalid.',block); }
          const youtube = ['www.youtube.com','youtube.com','youtu.be'].includes(url.hostname) && url.protocol === 'https:' && !url.username && !url.password && !url.port;
          if (youtube) {
            const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.startsWith('/embed/') ? url.pathname.slice(7) : '';
            if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) fail('youtube', 'The YouTube video ID is invalid.', block);
            return `<hx-video youtube="${id}" caption="${html(caption)}"></hx-video>`;
          }
        }
        const asset = await file(value,block,block.type);
        if (block.type === 'image') {
          if (!caption) warn('image-description', 'An image has no description.',block,'Add an English image caption in Notion.');
          return `![${markdown(caption)}](${asset.url})`;
        }
        if (block.type === 'video') return `<hx-video src="${asset.url}" caption="${html(caption)}"></hx-video>`;
        if (asset.extension === '.glb') return `<hx-model src="${asset.url}" alt="${html(caption || asset.filename)}"></hx-model>`;
        return `[${markdown(caption || asset.filename)}](${asset.url})`;
      }
      default: fail('unsupported-block', 'This Notion block type cannot be published yet.',block,'Replace it with supported text, lists, tables, images, files, or video.');
    }
  };
  // Sequential traversal fixes warning order, asset budgets and source order across runs.
  const sections = [];
  for (const block of snapshot.blocks) sections.push(await visit(block,1));
  const body = sections.filter(Boolean).join('\n\n');
  if (!body.trim()) fail('empty', 'The article body is empty.');
  const metadata = {entryId:snapshot.entryId,title:data.title,date:data.date,discipline:data.discipline,authors:data.authors,...(data.summary !== undefined ? {summary:data.summary} : {}),tags:data.tags || [],draft:false};
  const frontmatter = Object.entries(metadata).map(([key,value]) => key + ': ' + JSON.stringify(value)).join('\n');
  const content = '---\n' + frontmatter + '\n---\n\n' + body + '\n';
  if (Buffer.byteLength(content) > NOTION_CONTENT_LIMITS.document) fail('document-size', 'The converted article exceeds 256 KiB.',undefined,'Split the article into smaller entries.');
  assets.sort((a,b) => a.path.localeCompare(b.path));
  const post = {path,content};
  const manifest = [{path,sha256:contentDigest(content)},...assets.map(asset => ({path:asset.path,sha256:contentDigest(asset.bytes)}))].sort((a,b) => a.path.localeCompare(b.path));
  return {post,assets,warnings,manifest,digest:contentDigest(manifest)};
}
