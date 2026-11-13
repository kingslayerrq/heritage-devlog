// The same policy is used by local checks, branch validation, and deployment.
// Parse Markdown/HTML rather than searching raw prose for suspicious strings.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import yaml from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import { parseFragment } from 'parse5';
import { AUTHOR_ID, DEMO_AUTHORS, DISCORD_ID, GITHUB_LOGIN, profilesFromPeople, trustedAvatar } from './content-profiles.mjs';

export const DISCIPLINES = ['tech', 'art', 'design', 'audio', 'narrative', 'production'];
export const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.mp4', '.webm', '.glb', '.pdf', '.zip', '.txt']);
export const DEMO_POSTS = Object.freeze({
  'src/content/posts/2026-11-10-opening-the-door.md': '8388862e40f4bcc9b75f4d3d38ddc53628606e3c9c76657e4d09dc274939277d',
  'src/content/posts/2026-11-11-everything-a-page-can-hold.md': '0cc01de4ef166bd54f5e659fca647071bb97244a88f6d5af677dd04a26164215',
});
const MAX_DOCUMENT = 256 * 1024, MAX_MEDIA = 25 * 1024 * 1024, WARN_MEDIA = 800 * 1024 * 1024;
const POST_KEYS = new Set(['entryId', 'title', 'date', 'discipline', 'authors', 'summary', 'tags', 'cover', 'coverAlt', 'visibility', 'draft']);
const AUTHOR_KEYS = new Set(['name', 'avatar', 'discord', 'github', 'githubId', 'generated', 'active', 'demo', 'role', 'bio', 'discipline', 'links']);
const BLOCK_ATTRS = {
  'hx-video': ['src', 'poster', 'youtube', 'caption', 'loop'],
  'hx-gallery': ['caption'],
  'hx-compare': ['before', 'after', 'before-label', 'after-label', 'caption'],
  'hx-model': ['src', 'alt', 'caption'],
  'hx-blueprint': ['src', 'caption'],
  'hx-build': ['version', 'changelist', 'date'],
  'hx-note': ['kind'],
};
const HTML_ATTRS = {
  p: [], br: [], hr: [], strong: [], b: [], em: [], i: [], u: [], s: [], del: [], small: [], sub: [], sup: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], blockquote: [], pre: [], code: [], ul: [], ol: ['start'], li: [],
  table: [], thead: [], tbody: [], tr: [], th: ['colspan', 'rowspan', 'align'], td: ['colspan', 'rowspan', 'align'],
  details: ['open'], summary: [], a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  figure: [], figcaption: [], kbd: [],
  ...BLOCK_ATTRS,
};
const TEXT_ATTRS = new Set(['title', 'lang', 'dir']);
const parser = unified().use(remarkParse).use(remarkMath);
const text = value => typeof value === 'string' && value.trim() !== '';
const normalized = value => value.replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(normalized(value)).digest('hex');
const keyLine = (lines, key) => Math.max(1, lines.findIndex(line => line.startsWith(key + ':')) + 1);
const slash = value => value.replace(/\\/g, '/');

/** A strict portable path; hidden files, Windows aliases, traversal and encoded paths are not content. */
export function isAuthorContentPath(path) {
  if (typeof path !== 'string' || path.length > 240 || /[\\%:\x00-\x20\x7f]/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) return false;
  if (path.startsWith('src/content/posts/') && path.endsWith('.md')) return true;
  return path.startsWith('public/media/') && parts.length >= 4 && parts[2].toLowerCase() !== 'authors'
    && MEDIA_EXTENSIONS.has(extname(path));
}

export function parsePost(source, { path = '' } = {}) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_DOCUMENT) throw Object.assign(new Error('文章必须是 UTF-8 文本，且不超过 256 KiB。'), { code: 'document.size', line: 1, path });
  const lines = normalized(source).split('\n');
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (end < 0) throw Object.assign(new Error('文章必须以两行 --- 包围的 YAML 信息开头。'), { code: 'metadata.missing', line: 1, path });
  if (Buffer.byteLength(lines.slice(1, end).join('\n')) > 32768) throw Object.assign(new Error('文章信息不能超过 32 KiB。'), { code: 'metadata.size', line: 1, path });
  let data;
  try { data = yaml.load(lines.slice(1, end).join('\n'), { schema: yaml.CORE_SCHEMA }); }
  catch (error) { throw Object.assign(new Error('YAML 格式错误：' + (error.reason || error.message)), { code: 'metadata.yaml', line: (error.mark?.line ?? 0) + 2, path }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('文章信息必须是 YAML 对象。'), { code: 'metadata.object', line: 1, path });
  data = { visibility: 'public', draft: false, ...data };
  return { data, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2, lines };
}

/** No file traversal follows a symbolic link, including a directory at the traversal root. */
function filesUnder(directory, root, report) {
  if (!existsSync(directory)) return [];
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink()) { report('error', slash(relative(root, directory)), 1, 'file.symlink', '内容不能包含符号链接。', '改为真实的文件或目录。'); return []; }
  if (!stat.isDirectory()) return [directory];
  return readdirSync(directory).flatMap(name => filesUnder(join(directory, name), root, report));
}

function safeUrl(value, { image = false } = {}) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f\\]/.test(value)) return false;
  if (value.startsWith('/media/')) {
    try {
      const decoded = decodeURIComponent(value);
      return !/[\\\x00-\x20\x7f]/.test(decoded) && !decoded.split('/').some(part => part === '.' || part === '..') && !decoded.includes('?') && !decoded.includes('#');
    } catch { return false; }
  }
  if (!image && (value.startsWith('#') || /^\/(?:posts|people|crafts|tags)\//.test(value))) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' || (!image && url.protocol === 'mailto:'));
  } catch { return false; }
}

function checkSvg(source) {
  // SVG is served as an image and can also be opened directly. Only static shapes are permitted.
  if (/<!doctype|<!entity|<\?xml-stylesheet/i.test(source)) return false;
  const doc = parseFragment(source, { sourceCodeLocationInfo: true });
  const allowed = new Set(['svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);
  let valid = true, svg = false;
  const visit = node => {
    if (node.tagName) {
      svg ||= node.tagName === 'svg';
      if (!allowed.has(node.tagName)) valid = false;
      for (const attr of node.attrs || []) {
        if (/^on/i.test(attr.name) || ['href', 'src', 'style'].includes(attr.name) || attr.prefix === 'xlink') valid = false;
        if (/url\s*\(/i.test(attr.value) && !/^url\(\s*#[A-Za-z0-9_-]+\s*\)$/.test(attr.value)) valid = false;
      }
    }
    (node.childNodes || []).forEach(visit);
  };
  visit(doc); return valid && svg;
}

function hasMediaSignature(buffer, extension) {
  const start = buffer.subarray(0, 16);
  switch (extension) {
    case '.png': return start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case '.jpg': case '.jpeg': return start[0] === 255 && start[1] === 216 && start[2] === 255;
    case '.gif': return ['GIF87a', 'GIF89a'].includes(start.subarray(0, 6).toString('ascii'));
    case '.webp': return start.subarray(0, 4).toString('ascii') === 'RIFF' && start.subarray(8, 12).toString('ascii') === 'WEBP';
    case '.avif': return start.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(start.subarray(8, 12).toString('ascii'));
    case '.mp4': return start.subarray(4, 8).toString('ascii') === 'ftyp';
    case '.webm': return start.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
    case '.pdf': return start.subarray(0, 5).toString('ascii') === '%PDF-';
    case '.zip': return start[0] === 80 && start[1] === 75 && [3, 5, 7].includes(start[2]) && [4, 6, 8].includes(start[3]);
    case '.txt': return !buffer.includes(0);
    case '.glb': {
      if (buffer.length < 20 || buffer.subarray(0, 4).toString('ascii') !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length || buffer.readUInt32LE(16) !== 0x4e4f534a) return false;
      const length = buffer.readUInt32LE(12);
      if (length > buffer.length - 20) return false;
      try {
        const document = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
        // GLB attachments must be self-contained, including texture/buffer references.
        return document.asset?.version === '2.0' && [...(document.buffers || []), ...(document.images || [])]
          .every(item => item.uri === undefined || /^data:(?:image\/(?:png|jpeg)|application\/octet-stream);base64,[A-Za-z0-9+/=]+$/.test(item.uri));
      } catch { return false; }
    }
    default: return true;
  }
}

function checkBody(post, checkMedia, report) {
  const { body, bodyLine, path } = post;
  const ast = parser.parse(body);
  const rawLines = body.split('\n').map(() => '');
  const checkUrl = (url, line, image) => {
    if (!safeUrl(url, { image })) report('error', path, line, 'url.unsafe', '链接只能使用安全的 HTTPS 地址或站内 /media/ 路径。', '移除脚本、data:、协议相对地址或无效路径。');
    else if (url.startsWith('/media/')) checkMedia(path, line, url);
  };
  const walk = node => {
    const line = (node.position?.start.line || 1) + bodyLine - 1;
    if (['image', 'link', 'definition'].includes(node.type)) checkUrl(node.url, line, node.type === 'image');
    if (node.type === 'html') {
      const start = node.position.start.line - 1;
      node.value.split('\n').forEach((value, i) => { rawLines[start + i] += value; });
    }
    if (node.type === 'code') {
      const sourceLines = body.split('\n');
      const first = sourceLines[node.position.start.line - 1];
      const opening = /^\s*(`{3,}|~{3,})/.exec(first)?.[1];
      const last = sourceLines[node.position.end.line - 1];
      if (opening && !new RegExp('^\\s*' + opening[0] + '{' + opening.length + ',}\\s*$').test(last)) report('error', path, line, 'code.unclosed', '代码块缺少结束标记。', '在代码后补上对应的三个或更多反引号。');
    }
    (node.children || []).forEach(walk);
  };
  walk(ast);
  const html = parseFragment(rawLines.join('\n'), { sourceCodeLocationInfo: true });
  const visit = node => {
    if (node.tagName) {
      const tag = node.tagName;
      const line = (node.sourceCodeLocation?.startLine || 1) + bodyLine - 1;
      if (!Object.hasOwn(HTML_ATTRS, tag)) report('error', path, line, 'html.tag', '不支持或不安全的 HTML 标签 <' + tag + '>。', '使用普通 Markdown 或文档列出的 hx-* 块。');
      const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
      for (const { name, value, namespace } of node.attrs || []) {
        if (namespace || !(HTML_ATTRS[tag]?.includes(name) || TEXT_ATTRS.has(name))) report('error', path, line, 'html.attribute', '<' + tag + '> 不允许属性 ' + name + '。', '移除样式、事件处理器和未列出的属性。');
        if (['href', 'src', 'poster', 'before', 'after'].includes(name)) checkUrl(value, line, name !== 'href');
      }
      if (Object.hasOwn(BLOCK_ATTRS, tag) && !node.sourceCodeLocation?.endTag) report('error', path, line, 'block.unclosed', '<' + tag + '> 缺少关闭标签。', '补上 </' + tag + '>。');
      if (tag === 'hx-video' && !attrs.src && !attrs.youtube) report('error', path, line, 'block.video', '视频块需要 src 或 youtube。', '指定上传视频路径或 YouTube 视频 ID。');
      if (tag === 'hx-video' && attrs.youtube && !/^[\w-]{6,20}$/.test(attrs.youtube)) report('error', path, line, 'block.youtube', 'youtube 必须是视频 ID。', '不要填写整个 YouTube 地址。');
      if (tag === 'hx-compare' && (!attrs.before || !attrs.after)) report('error', path, line, 'block.compare', '对比块需要 before 和 after 两张图片。', '补全两个图片路径。');
      if (tag === 'hx-model' && !/^\/media\/.+\.glb$/.test(attrs.src || '')) report('error', path, line, 'block.model', '模型块需要本地 .glb 文件。', '使用 /media/文章目录/模型.glb。');
      if (tag === 'hx-blueprint') {
        let valid = false;
        try { const url = new URL(attrs.src); valid = url.protocol === 'https:' && url.hostname === 'blueprintue.com' && !url.username && !url.password && /^\/render\/[\w-]+\/?$/.test(url.pathname); } catch { /* invalid source */ }
        if (!valid) report('error', path, line, 'block.blueprint', 'Blueprint 块需要 HTTPS blueprintue.com/render/ID/ 地址。', '复制 BlueprintUE 的嵌入地址。');
      }
    }
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(html);
}

export function validateContent({ root, people, paths, allowUnresolvedAuthors = false } = {}) {
  root = resolve(root || '.');
  const issues = [];
  const report = (severity, path, line, code, message, fix) => {
    if (!issues.some(item => item.path === path && item.line === line && item.code === code && item.message === message)) issues.push({ severity, path, line, code, message, ...(fix ? { fix } : {}) });
  };
  const authors = [], posts = [];
  let registry = null;
  if (people !== undefined) {
    try { registry = new Map(profilesFromPeople(people).map(person => [person.id, person])); }
    catch (error) { report('error', 'src/content/authors', 1, 'identity.registry', error.message, '由管理员检查 Discord 身份登记同步。'); registry = new Map(); }
  }
  // Check parent folders before walking; never follow a linked parent.
  for (const part of ['src', 'src/content', 'public']) {
    const path = join(root, part);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      report('error', part, 1, 'file.symlink', '内容目录不能是符号链接。', '恢复真实目录。');
      return { issues, posts, authors, errors: issues, warnings: [] };
    }
  }
  const allFiles = [...filesUnder(join(root, 'src/content/posts'), root, report), ...filesUnder(join(root, 'src/content/authors'), root, report), ...filesUnder(join(root, 'public/media'), root, report)];
  const cases = new Set();
  for (const file of allFiles) {
    const path = slash(relative(root, file)), key = path.toLowerCase();
    if (cases.has(key)) report('error', path, 1, 'file.case', '存在只差大小写的文件路径。', '给文件使用唯一名称。');
    cases.add(key);
  }
  const knownFiles = new Set(allFiles.map(file => slash(relative(root, file))));
  for (const path of paths || []) if (!isAuthorContentPath(path) || !knownFiles.has(path)) report('error', path, 1, 'file.missing', '找不到要验证的文章文件。');
  const mediaFiles = new Set(allFiles.filter(file => slash(relative(root, file)).startsWith('public/media/')).map(file => slash(relative(root, file))));
  const checkMedia = (path, line, value) => {
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { decoded = ''; }
    if (!safeUrl(value, { image: true }) || !mediaFiles.has('public' + decoded)) report('error', path, line, 'media.missing', '找不到媒体文件：' + value, '检查 public/media 下的文件、拼写和大小写。');
  };
  for (const file of allFiles.filter(file => slash(relative(root, file)).startsWith('src/content/authors/'))) {
    const path = slash(relative(root, file)), id = basename(file, '.json');
    if (extname(file) !== '.json' || !AUTHOR_ID.test(id)) { report('error', path, 1, 'identity.filename', '作者文件必须使用合法的稳定 ID 和 .json 扩展名。'); continue; }
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { report('error', path, 1, 'identity.json', '作者资料不是有效 JSON。'); continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { report('error', path, 1, 'identity.object', '作者资料必须是 JSON 对象。'); continue; }
    for (const key of Object.keys(data)) if (!AUTHOR_KEYS.has(key)) report('error', path, 1, 'identity.field', '作者资料含未知字段：' + key);
    const demo = DEMO_AUTHORS.has(id) && data.demo === true;
    if (!text(data.name)) report('error', path, 1, 'identity.name', '作者缺少显示名称。');
    if (!demo) {
      if (data.demo || data.generated !== true || !DISCORD_ID.test(data.discord || '') || typeof data.discord !== 'string') report('error', path, 1, 'identity.discord', '作者必须有通过 Discord 登记的身份。', '运行 /devlog-access register；不要手写作者资料。');
      if (['role', 'bio', 'discipline', 'links'].some(key => data[key] !== undefined)) report('error', path, 1, 'identity.manual', '身份资料由平台同步，不能手动填写。', '保留文章内容字段，通过 Discord 绑定账号。');
      if (data.github !== undefined && (!GITHUB_LOGIN.test(data.github) || !Number.isSafeInteger(data.githubId) || data.githubId < 1)) report('error', path, 1, 'identity.github', 'GitHub 连接缺少有效的已验证账号 ID。');
      if (data.avatar) { try { trustedAvatar(data.avatar); } catch { report('error', path, 1, 'identity.avatar', '作者头像必须来自 Discord CDN。'); } }
      if (registry) {
        const expected = registry.get(id);
        if (!expected || JSON.stringify(data) !== JSON.stringify(Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'id')))) report('error', path, 1, 'identity.changed', '作者资料与已验证登记不一致。', '从 Discord 登记同步生成，不要从分支提供身份信息。');
      }
    }
    authors.push({ id, ...data });
  }
  const byAuthor = new Map(authors.map(author => [author.id, author]));
  for (const file of allFiles.filter(file => slash(relative(root, file)).startsWith('src/content/posts/'))) {
    const path = slash(relative(root, file));
    if (!isAuthorContentPath(path)) { report('error', path, 1, 'file.type', '文章目录只允许 Markdown .md 文件。'); continue; }
    if (paths?.length && !paths.includes(path)) continue;
    if (lstatSync(file).size > MAX_DOCUMENT) { report('error', path, 1, 'document.size', '文章不能超过 256 KiB。'); continue; }
    const sourceBytes = readFileSync(file);
    if (!isUtf8(sourceBytes)) { report('error', path, 1, 'document.encoding', '文章必须使用有效 UTF-8 编码。'); continue; }
    const source = sourceBytes.toString('utf8');
    let parsed;
    try { parsed = parsePost(source, { path }); }
    catch (error) { report('error', path, error.line || 1, error.code, error.message); continue; }
    const { data, lines, body } = parsed, at = key => keyLine(lines, key);
    const post = { path, slug: path.slice('src/content/posts/'.length, -3), ...parsed };
    posts.push(post);
    const demo = DEMO_POSTS[path] === hash(source);
    const filename = basename(file, '.md');
    if (!/^\d{4}-\d{2}-\d{2}-[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(filename)) report('error', path, 1, 'post.filename', '文件名应为 YYYY-MM-DD-简短标题.md。', '使用日期和字母、中文或数字；用连字符分隔。');
    for (const key of Object.keys(data)) if (!POST_KEYS.has(key)) report('error', path, at(key), 'metadata.field', '未知文章字段：' + key);
    if (!text(data.title)) report('error', path, at('title'), 'post.title', '缺少文章标题 title。');
    else if (data.title.length > 120) report('warning', path, at('title'), 'post.long-title', '标题超过 120 个字符，Discord 报告会截短显示。');
    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date) report('error', path, at('date'), 'post.date', 'date 必须是有效的 YYYY-MM-DD 日期。');
    if (!DISCIPLINES.includes(data.discipline)) report('error', path, at('discipline'), 'post.discipline', 'discipline 必须是 ' + DISCIPLINES.join(', ') + ' 之一。');
    if (data.entryId !== undefined && (typeof data.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(data.entryId))) report('error', path, at('entryId'), 'post.entry-id', 'entryId 必须是 8–64 位稳定字母数字 ID。');
    if (!Array.isArray(data.authors) || !data.authors.length || data.authors.length > 20 || data.authors.some(id => typeof id !== 'string' || !AUTHOR_ID.test(id))) report('error', path, at('authors'), 'post.authors', 'authors 必须列出 1–20 个已登记作者 ID。', '运行 /devlog-access status 查看你的作者 ID。');
    else {
      if (new Set(data.authors).size !== data.authors.length) report('error', path, at('authors'), 'post.duplicate-author', '作者重复列出。');
      for (const id of data.authors) {
        const author = byAuthor.get(id);
        if (!author && allowUnresolvedAuthors && !registry && !DEMO_AUTHORS.has(id)) report('warning', path, at('authors'), 'post.identity-deferred', '本地尚未同步作者 ' + id + '；发布前 GitHub 会验证真实 Discord 身份。', '运行 npm run sync:authors 刷新本地资料。');
        else if (!author || (DEMO_AUTHORS.has(id) && !demo)) report('error', path, at('authors'), 'post.unknown-author', '作者尚未登记，或使用了示例作者：' + id, '使用 /devlog-access register 登记，并填写真实作者 ID。');
      }
    }
    if (data.summary === undefined) report('warning', path, 1, 'post.summary', '没有 summary，首页与 Discord 将只显示标题。', '添加一两句摘要。');
    else if (!text(data.summary)) report('error', path, at('summary'), 'post.summary', 'summary 必须是非空文本。');
    else if (data.summary.length > 300) report('warning', path, at('summary'), 'post.long-summary', '摘要超过 300 个字符，建议缩短为一两句。');
    if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.length > 30 || data.tags.some(tag => !text(tag) || tag.length > 80))) report('error', path, at('tags'), 'post.tags', 'tags 必须是最多 30 个非空短标签。');
    if (typeof data.draft !== 'boolean') report('error', path, at('draft'), 'post.draft', 'draft 必须是 true 或 false。');
    if (data.draft === true) report('warning', path, at('draft'), 'post.draft', '此文章是草稿，不会出现在网站上。公开仓库中的原文件仍可被访问。');
    if (data.visibility === 'private') report('warning', path, at('visibility'), 'post.private', '此文章设为私密，不会出现在网站上。公开仓库中的原文件和媒体仍可被访问。', '不要写入机密内容；改为 visibility: public 即可在网站上显示。');
    else if (data.visibility !== 'public') report('error', path, at('visibility'), 'post.visibility', 'visibility 只能是 public 或 private。此仓库公开，不能提交 internal 等机密文章。', '使用 visibility: public 或 visibility: private。');
    if (data.cover !== undefined) {
      if (!safeUrl(data.cover, { image: true })) report('error', path, at('cover'), 'post.cover', '封面必须是 /media/ 路径或 HTTPS 地址。');
      else {
        if (data.cover.startsWith('/media/')) checkMedia(path, at('cover'), data.cover);
        if (/\.svg(?:$|\?)/i.test(data.cover)) report('warning', path, at('cover'), 'post.svg-cover', 'Discord 无法显示 SVG 封面，报告将省略封面图。');
        if (!text(data.coverAlt)) report('warning', path, at('cover'), 'post.cover-alt', '封面缺少 coverAlt。', '为使用屏幕阅读器的读者描述封面。');
      }
    }
    if (!body.trim()) report('error', path, parsed.bodyLine, 'post.empty', '文章缺少正文。');
    checkBody(post, checkMedia, report);
  }
  const ids = new Map();
  for (const post of posts) if (post.data.entryId) {
    if (ids.has(post.data.entryId)) report('error', post.path, 1, 'post.duplicate-id', 'entryId 与另一篇文章重复：' + ids.get(post.data.entryId));
    ids.set(post.data.entryId, post.path);
  }
  let total = 0;
  for (const file of allFiles.filter(file => slash(relative(root, file)).startsWith('public/media/'))) {
    const path = slash(relative(root, file)), size = lstatSync(file).size;
    total += size;
    if (!MEDIA_EXTENSIONS.has(extname(file))) report('error', path, 1, 'media.type', '不支持的媒体扩展名。', '仅提交图片、MP4/WebM、GLB、PDF、ZIP 或文本附件。');
    if (size > MAX_MEDIA) report('error', path, 1, 'media.size', '媒体文件超过 25 MiB。', '压缩文件；较长视频使用 YouTube。');
    if (size <= MAX_MEDIA && !hasMediaSignature(readFileSync(file), extname(file))) report('error', path, 1, 'media.signature', '文件内容与扩展名不符，或 GLB 包含外部资源。', '重新导出对应格式；GLB 必须包含自身纹理与缓冲数据。');
    if (extname(file) === '.svg' && (size > 1024 * 1024 || !checkSvg(readFileSync(file, 'utf8')))) report('error', path, 1, 'media.svg', 'SVG 仅允许静态形状，不能包含脚本、样式、外部资源或交互内容。', '导出为 PNG，或简化为静态 SVG。');
  }
  if (total > WARN_MEDIA) report('warning', 'public/media', 1, 'media.total', '媒体总大小接近 GitHub Pages 站点限制。', '压缩图片与视频。');
  issues.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.code.localeCompare(b.code));
  return { issues, posts, authors, errors: issues.filter(issue => issue.severity === 'error'), warnings: issues.filter(issue => issue.severity === 'warning') };
}
