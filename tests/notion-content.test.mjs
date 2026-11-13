import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { parseFragment } from 'parse5';
import { compileNotionSnapshot, contentDigest, stableStringify, downloadNotionAsset, trustedNotionAssetUrl, NotionContentError } from '../scripts/notion-content.mjs';
import { parsePost, validateContent } from '../scripts/content-policy.mjs';
import { syncAuthorProfiles } from '../scripts/content-profiles.mjs';

const PAGE = 'a'.repeat(32), MEDIA = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/file/';
const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
const person = {author:'notion-writer',discord:'123456789012345678',name:'Notion Writer',active:true};
let serial = 0;
const text = (content, annotations = {}, url = null) => ({type:'text',text:{content,link:url ? {url} : null},annotations});
const block = (type, value = {}, children) => ({object:'block',id:(++serial).toString(16).padStart(32,'0'),type,[type]:value,...(children ? {has_children:true,children} : {})});
const snapshot = blocks => ({id:'submission-1',pageId:PAGE,entryId:'notion-' + PAGE,path:'src/content/posts/2026-11-11-notion-entry.md',metadata:{title:'English: Notion entry',date:'2026-11-11',discipline:'design',authors:[person.author],summary:'What changed and why.',tags:['Playtesting']},blocks:blocks || [block('paragraph',{rich_text:[text('The first test.') ]})]});
const file = (type,name,caption = 'An English description.') => block(type,{type:'file',file:{url:MEDIA+name+'?signed=do-not-log'},caption:[text(caption)],name});
function validate(t, result) {
  const root = mkdtempSync(join(tmpdir(),'heritage-notion-content-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  syncAuthorProfiles({root,people:[person]});
  for (const item of [result.post,...result.assets]) { const file = join(root,item.path); mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,item.content ?? item.bytes); }
  const checked = validateContent({root,people:[person]});
  assert.deepEqual(checked.errors,[],JSON.stringify(checked.issues));
  return checked;
}
const codeOf = code => error => error instanceof NotionContentError && error.code === 'notion.' + code;

test('metadata and literal wording survive deterministic conversion and native validation', async t => {
  const original = '<script>alert("literal")</script> **not bold** [not a link](javascript:bad) @everyone 中文';
  const input = snapshot([
    block('heading_1',{rich_text:[text('What changed')]}),
    block('paragraph',{rich_text:[text(original),text(' bold ',{bold:true}),text('*literal inline code*',{code:true}),text('link',{},'https://example.com/notes')]}),
    block('quote',{rich_text:[text('A playtester’s observation.')]}),
    block('bulleted_list_item',{rich_text:[text('One item')]},[block('numbered_list_item',{rich_text:[text('Nested item')]})]),
    block('to_do',{rich_text:[text('Check contrast')],checked:false}),
    block('divider'),
    block('code',{rich_text:[text('const text = "```";\n// Keep wording.')],language:'javascript',caption:[]})
  ]);
  const result = await compileNotionSnapshot(input);
  assert.deepEqual(result,await compileNotionSnapshot(structuredClone(input)));
  assert.equal(parsePost(result.post.content).data.title,input.metadata.title);
  assert.equal(parsePost(result.post.content).data.draft,false);
  assert.match(result.post.content,/## What changed/);
  assert.match(result.post.content,/````javascript/);
  validate(t,result);
  const rendered = (await (await createMarkdownProcessor({smartypants:false})).render(parsePost(result.post.content).body)).code;
  let visible = '', scriptFound = false;
  const walk = node => { if (node.nodeName === '#text') visible += node.value; if (node.tagName === 'script') scriptFound = true; (node.childNodes || []).forEach(walk); };
  walk(parseFragment(rendered));
  assert.equal(scriptFound,false); assert.ok(visible.includes(original)); assert.ok(visible.includes('*literal inline code*'));
  assert.equal(result.digest,contentDigest(result.manifest));
  assert.equal(result.manifest[0].sha256,contentDigest(result.post.content));
});

test('rich formatting, nested columns, callouts, tables and equations preserve content', async t => {
  const input = snapshot([
    block('paragraph',{rich_text:[text('green',{color:'green',italic:true,underline:true,strikethrough:true}),text('a < b',{code:true})]}),
    block('column_list',{},[block('column',{},[block('paragraph',{rich_text:[text('Left column')]})]),block('column',{},[block('paragraph',{rich_text:[text('Right column')]})])]),
    block('callout',{icon:{type:'emoji',emoji:'💡'},rich_text:[text('A useful note')]},[block('paragraph',{rich_text:[text('More context')]})]),
    block('table',{table_width:2,has_column_header:true,has_row_header:false},[
      block('table_row',{cells:[[text('Version')],[text('Result')]]}),
      block('table_row',{cells:[[text('A | B')],[text('**literal** <result>',{bold:true})]]})
    ]),
    block('equation',{expression:'t = \\frac{d}{v}'}),
    block('bookmark',{url:'https://example.com/source',caption:[text('Source material')]})
  ]);
  const result = await compileNotionSnapshot(input);
  validate(t,result);
  assert.deepEqual(result.warnings.map(item=>item.code),['notion.color','notion.columns']);
  assert.ok(result.post.content.indexOf('Left column') < result.post.content.indexOf('Right column'));
  assert.match(result.post.content,/<strong>\*\*literal\*\* &lt;result&gt;<\/strong>/);
  assert.match(result.post.content,/<hx-note>/);
});

test('media is copied once to stable content-addressed paths without signed URLs', async t => {
  const input = snapshot([file('image','door.png'),file('image','door.png','A second view.'),file('file','door.png','Download the image')]);
  let calls = 0;
  const result = await compileNotionSnapshot(input,{download:async()=>{ calls++; return {bytes:PNG}; }});
  assert.equal(calls,1); assert.equal(result.assets.length,1);
  assert.equal(result.assets[0].path,`public/media/notion-${PAGE}/${contentDigest(PNG)}.png`);
  assert.equal(result.manifest.length,2);
  assert.ok(!result.post.content.includes('signed=')); assert.ok(!JSON.stringify(result.warnings).includes('do-not-log'));
  validate(t,result);
  const renewed = structuredClone(input);
  for (const item of renewed.blocks) item[item.type].file.url = item[item.type].file.url.replace('do-not-log','renewed-signature');
  assert.equal((await compileNotionSnapshot(renewed,{download:async()=>({bytes:PNG})})).digest,result.digest);
});

test('video and file attachments use native supported blocks', async t => {
  const mp4 = Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109]);
  const input = snapshot([file('video','clip.mp4'),file('pdf','notes.pdf'),file('file','notes.txt'),
    block('video',{type:'external',external:{url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},caption:[text('A walkthrough')]})]);
  const result = await compileNotionSnapshot(input,{download:async url=>({bytes:url.includes('.mp4')?mp4:url.includes('.pdf')?Buffer.from('%PDF-1.7'):Buffer.from('Our notes.')})});
  assert.match(result.post.content,/<hx-video src="\/media\//);
  assert.match(result.post.content,/youtube="dQw4w9WgXcQ"/);
  assert.equal(result.assets.length,3); validate(t,result);
});

test('unsupported content fails with a source block link, never silently disappears', async () => {
  const item = block('synced_block',{synced_from:{block_id:'b'.repeat(32)}});
  await assert.rejects(compileNotionSnapshot(snapshot([item])),error => {
    assert.equal(error.code,'notion.unsupported-block');
    assert.equal(error.issues[0].sourceUrl,`https://www.notion.so/${PAGE}#${item.id}`);
    assert.match(error.issues[0].fix,/Source: https:\/\/www.notion.so\//); return true;
  });
  await assert.rejects(compileNotionSnapshot(snapshot([block('paragraph',{rich_text:[{type:'mention',plain_text:'Someone',mention:{type:'user'}}]})])),codeOf('rich-text-type'));
  await assert.rejects(compileNotionSnapshot(snapshot([{...block('paragraph',{rich_text:[text('Missing children')]}),has_children:true}])),codeOf('children-missing'));
  await assert.rejects(compileNotionSnapshot(snapshot([block('code',{rich_text:[text('code',{bold:true})],language:'text'})])),codeOf('plain-text'));
});

test('metadata and content cannot supply traversal, YAML injections or unsafe links', async () => {
  const input = snapshot(); input.path = 'src/content/posts/../../scripts/payload.mjs';
  await assert.rejects(compileNotionSnapshot(input),codeOf('path'));
  input.path = snapshot().path; input.metadata.visibility = 'internal';
  await assert.rejects(compileNotionSnapshot(input),codeOf('metadata'));
  // Private is the only non-public value; public adds no key, so existing imports stay byte-identical.
  input.metadata.visibility = 'private';
  const hidden = await compileNotionSnapshot(input);
  assert.equal(parsePost(hidden.post.content).data.visibility,'private');
  assert.equal(parsePost(hidden.post.content).data.draft,false);
  input.metadata.visibility = 'public';
  const shown = await compileNotionSnapshot(input);
  assert.ok(!shown.post.content.includes('visibility'));
  delete input.metadata.visibility;
  assert.equal((await compileNotionSnapshot(input)).post.content,shown.post.content);
  const bad = snapshot([block('paragraph',{rich_text:[text('click',{},'javascript:alert(1)')]})]);
  await assert.rejects(compileNotionSnapshot(bad),codeOf('url'));
  for (const value of ['http://example.com','https://user:pass@example.com','https://example.com/a\nb']) {
    await assert.rejects(compileNotionSnapshot(snapshot([block('bookmark',{url:value})])),codeOf('url'));
  }
  const changed = snapshot(); changed.metadata.title = 'Title\nauthors: [forged]';
  const compiled = await compileNotionSnapshot(changed);
  assert.deepEqual(parsePost(compiled.post.content).data.authors,[person.author]);
});

test('media rejects private hosts, redirects, bad signatures, unsafe SVG and kind-cache confusion', async () => {
  for (const url of ['http://127.0.0.1/a.png','https://127.0.0.1/a.png','https://cdn.discordapp.com.attacker.invalid/a.png','https://s3.us-west-2.amazonaws.com/attacker/a.png','https://user:secret@file.notion.so/a.png','https://example.com/a.png']) {
    const input = snapshot([block('image',{type:'external',external:{url},caption:[]})]);
    await assert.rejects(compileNotionSnapshot(input),codeOf('media-host'));
  }
  await assert.rejects(compileNotionSnapshot(snapshot([file('image','fake.png')]),{download:async()=>({bytes:Buffer.from('<html>fake</html>')})}),codeOf('media-format'));
  await assert.rejects(compileNotionSnapshot(snapshot([file('image','fake.svg')]),{download:async()=>({bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>')})}),codeOf('media-format'));
  await assert.rejects(compileNotionSnapshot(snapshot([file('file','notes.pdf'),file('image','notes.pdf')]),{download:async()=>({bytes:Buffer.from('%PDF-1.7')})}),codeOf('media-format'));
  assert.equal(trustedNotionAssetUrl('https://s3.us-west-2.amazonaws.com/secure.notion-static.com/file/a.png?signature=ok'),true);
});

test('downloads enforce byte limits and never disclose signed URLs on errors', async () => {
  const url = MEDIA+'file.png?signature=private';
  let options;
  const result = await downloadNotionAsset(url,{maxBytes:8,fetch:async(_url,opts)=>{ options=opts; return new Response(PNG,{headers:{'Content-Length':'8','Content-Type':'image/png'}}); }});
  assert.deepEqual(result.bytes,PNG); assert.equal(options.redirect,'manual'); assert.deepEqual(options.headers,{Accept:'*/*'});
  for (const fetch of [async()=>new Response('redirect',{status:302,headers:{Location:'http://127.0.0.1'}}),async()=>new Response(PNG),async()=>{throw new Error(url);}]) {
    await assert.rejects(downloadNotionAsset(url,{maxBytes:4,fetch}),error=>!error.message.includes('signature') && !error.message.includes('private'));
  }
  await assert.rejects(compileNotionSnapshot(snapshot([file('image','file.png')]),{download:async()=>{throw new Error(url);}}),error=>error.code==='notion.media-download' && !JSON.stringify(error.issues).includes('signature'));
});

test('document, block, depth, media count and per-file bounds fail closed', async () => {
  await assert.rejects(compileNotionSnapshot(snapshot([block('paragraph',{rich_text:[text('x'.repeat(256*1024+1))]})])),codeOf('document-size'));
  await assert.rejects(compileNotionSnapshot(snapshot(Array.from({length:501},()=>block('paragraph',{rich_text:[text('x')]})))),codeOf('block-limit'));
  let deep = block('paragraph',{rich_text:[text('bottom')]}); for(let i=0;i<12;i++) deep=block('paragraph',{rich_text:[text('level')]},[deep]);
  await assert.rejects(compileNotionSnapshot(snapshot([deep])),codeOf('block-limit'));
  await assert.rejects(compileNotionSnapshot(snapshot(Array.from({length:21},(_,i)=>file('image',`${i}.png`))),{download:async()=>({bytes:PNG})}),codeOf('media-count'));
  await assert.rejects(compileNotionSnapshot(snapshot([file('image','large.png')]),{download:async()=>({bytes:Buffer.alloc(25*1024*1024+1)})}),codeOf('media-size'));
});


test('nested task lists remain lists rather than becoming indented code', async () => {
  const input = snapshot([block('to_do',{rich_text:[text('Parent')],checked:false},[block('bulleted_list_item',{rich_text:[text('Child')]})])]);
  const result = await compileNotionSnapshot(input);
  const rendered = (await (await createMarkdownProcessor()).render(parsePost(result.post.content).body)).code;
  assert.equal((rendered.match(/<ul/g) || []).length,2);
  assert.ok(!rendered.includes('<pre>'));
});

test('canonical manifests have stable hashes and reject non-JSON values', () => {
  assert.equal(stableStringify({b:2,a:[{z:0,x:1}]}),'{"a":[{"x":1,"z":0}],"b":2}');
  assert.equal(contentDigest({a:1,b:2}),contentDigest({b:2,a:1}));
  const cycle={}; cycle.self=cycle;
  for(const input of [cycle,{number:NaN},{missing:undefined}]) assert.throws(()=>stableStringify(input));
});
