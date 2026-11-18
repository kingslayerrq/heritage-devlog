import test from 'node:test';
import assert from 'node:assert/strict';
import { sendItemCard, writeCard } from '../scripts/report-cards.mjs';
import { legacyArticleKeys, removalReport, resolutionPayload, resolveItem, warningGroups, warnItems } from '../scripts/report-items.mjs';

const webhookId = '111111111111111111', channelId = '222222222222222222', guildId = '333333333333333333';
const rootId = '444444444444444444', replyId = '555555555555555555';
const webhook = 'https://discord.com/api/webhooks/' + webhookId + '/test', repo = 'team/posts';
const head = 'a'.repeat(40), payload = { content: '<@666666666666666666>', allowed_mentions: { parse: [], users: ['666666666666666666'] },
  embeds: [{ title: '更新', color: 123, fields: [{ name: '链接', value: 'Git' }], timestamp: new Date(0).toISOString() }] };
const options = { repo, webhook, kind: 'edit', item: 'article:id', revision: head, order: '100', operation: 'publish', payload };
function harness({ exists = false, legacy, missing, reject } = {}) {
  const receipts = new Map(), requests = [], calls = [], reservation = 'a'.repeat(64);
  const integration = async body => {
    calls.push(body);
    if (body.action === 'reserve-card') {
      const rec = receipts.get(body.key);
      if (rec?.state === 'sent' || rec?.state === 'uncertain') return rec;
      const reserved = { state: 'reserved', reservation, existing: exists, ...(exists ? { messageId: rootId } : {}), ...legacy };
      receipts.set(body.key, { ...reserved, operation: body.operation });
      return reserved;
    }
    const rec = receipts.get(body.key);
    if (body.action === 'ensure-card-thread') return { threadId: rootId };
    if (body.action === 'adopt-card') { rec.existing = !body.sameEvent; return {}; }
    if (body.action === 'missing-card') { rec.existing = false; return {}; }
    if (body.action === 'complete-card') {
      Object.assign(rec, { state: body.outcome, messageId: body.messageId, channelId: rec.operation === 'reply' ? rootId : channelId, guildId, rootId });
      if (rec.operation !== 'reply' && rec.state === 'sent') exists = true;
      return rec;
    }
    throw new Error('Unexpected action ' + body.action);
  };
  const fetch = async (url, request) => {
    const method = request.method, thread = url.searchParams.get('thread_id');
    if (method === 'GET' && !url.pathname.includes('/messages/')) return Response.json({ id: webhookId, channel_id: channelId, guild_id: guildId });
    requests.push({ method, path: url.pathname, thread, body: request.body && JSON.parse(request.body) });
    if (missing && method === 'PATCH') { missing = false; return Response.json({ code: 10008 }, { status: 404 }); }
    if (reject) throw new Error('lost response');
    return Response.json({ id: thread ? replyId : rootId, webhook_id: webhookId, channel_id: thread || channelId, embeds: payload.embeds });
  };
  return { integration, fetch, requests, calls };
}
test('first article creates one card, rerun is silent, revisions edit and ping once in its thread', async () => {
  const f = harness();
  const first = { ...options, ...f };
  await sendItemCard(first); await sendItemCard(first);
  const next = { ...first, revision: 'b'.repeat(40), order: '101' };
  const success = await sendItemCard(next); await sendItemCard(next);
  assert.deepEqual(f.requests.map(req => [req.method, req.thread]), [['POST', null], ['PATCH', null], ['POST', rootId]]);
  assert.equal(f.requests[1].body.content, ''); assert.deepEqual(f.requests[1].body.allowed_mentions.parse, []);
  assert.equal(f.requests[2].body.content, payload.content);
  assert.equal(success.successUrl, 'https://discord.com/channels/' + guildId + '/' + rootId + '/' + replyId);
});
test('only confirmed unknown message permits recreating a root and suppresses an extra revision', async () => {
  const f = harness({ exists: true, missing: true });
  await sendItemCard({ ...options, ...f });
  assert.deepEqual(f.requests.map(r => r.method), ['PATCH', 'POST']);
  assert.ok(f.calls.some(call => call.action === 'missing-card'));
});
test('network failure on create holds for inspection while an edit can retry', async () => {
  for (const exists of [true, false]) {
    const f = harness({ exists, reject: true });
    await assert.rejects(writeCard({ ...options, ...f }), /REPORT_KEY/);
    assert.equal(f.calls.at(-1).outcome, exists ? 'failed' : 'uncertain');
  }
});
test('verified same-event legacy message is quietly adopted without sending an extra notification', async () => {
  const f = harness({ legacy: { legacyMessageIds: [rootId], legacyEventMessageId: rootId } });
  await sendItemCard({ ...options, ...f });
  assert.deepEqual(f.requests.map(r => r.method), ['GET', 'PATCH']);
  assert.ok(f.calls.some(call => call.action === 'adopt-card' && call.sameEvent === true));
  assert.ok(legacyArticleKeys(repo, 'publish', 'one', head, Array.from({length:64}, (_, i) => i.toString(16).padStart(40, '0'))).length <= 32);
});
test('multiple articles get separate warnings and uncertain paths stay attached to their PR', () => {
  const articles = [{ id:'one', path:'one.md' }, { id:'two', path:'two.md' }];
  const groups = warningGroups({ pr:4, articles }, [{ path:'one.md' }, { path:'one.md' }, { path:'two.md' }, { path:'bad.yml' }], 'scope');
  assert.deepEqual(groups.map(g => [g.item, g.issues.length]), [['article:one', 2], ['article:two', 1], ['pr:4', 1]]);
});
test('public removal uses only last public title and credits and exposes no article or private source links', () => {
  const writer = { author:'old', name:'Original', discord:'123456789012345678' };
  const editor = { author:'new', name:'PrivateEditor', githubId:73, discord:'223456789012345678' };
  const result = removalReport({ repo, head, people:[writer,editor], actor:{id:73, login:'PrivateEditor'},
    source:{sourceUrl:'https://www.notion.so/privatedraft'}, pr:1 }, {data:{ title:'Public title', authors:['old'] }});
  assert.deepEqual(result.allowed_mentions.users, [writer.discord]);
  assert.ok(result.embeds[0].title.includes('Public title'));
  assert.doesNotMatch(JSON.stringify(result), /privatedraft|PrivateEditor|https:|223456789012345678/);
});
test('public withdrawal resolves its warning with a link to the confirmed removal', async () => {
  const success = { state:'sent', guildId, channelId, messageId:rootId, withdrawn:true };
  let text;
  await resolveItem({ context:{ repo, head, runId:42, pr:2 }, item:'article:one', success,
    resolve: async options => { text = options.payload({embeds:[{title:'⚠️ 待处理 · 内容检查提醒', fields:[]}]}).embeds[0]; } });
  assert.ok(text.title.includes('✅ 已解决 · 已从公开网站移除'));
  assert.ok(text.fields[0].value.includes('[查看移除确认](https://discord.com/channels/' + guildId + '/' + channelId + '/' + rootId + ')'));
});
test('Notion source diagnostics before a branch exists match the deployed page and retain original advice', async () => {
  const pageId = 'a'.repeat(32), calls = [];
  const context = { repo, head, actor:{ id:0 }, runId:200, source:{ pageId, createdAt:1000 }, people:[] };
  const capture = async options => { calls.push(options); };
  await warnItems({ context, kind:'warning', scope:'notion:first', issues:[{ path:'', severity:'warning', message:'颜色已调整。' }], send:capture });
  const success = { state:'sent', guildId, channelId, messageId:rootId, successUrl:'https://discord.com/channels/' + guildId + '/' + rootId + '/' + replyId };
  await resolveItem({ context:{ ...context, pr:99, runId:300 }, item:'article:notion-' + pageId, success, resolve:capture });
  assert.equal(calls[0].lineage, calls[1].lineage);
  assert.equal(calls[0].item, calls[1].item);
  assert.equal(calls[0].order, calls[1].order);
  const before = calls[0].payload.embeds[0], resolved = calls[1].payload({ embeds:[before] }).embeds[0];
  assert.ok(before.title.includes('待处理')); assert.ok(!resolved.title.includes('待处理'));
  assert.ok(resolved.title.includes('✅ 已解决 · 发布成功'));
  assert.equal(resolved.color, 0x2ecc71); assert.ok(resolved.fields[0].value.includes(success.successUrl));
  assert.deepEqual(resolved.fields.slice(1), before.fields);
  assert.equal(resolutionPayload({ embeds:[resolved] }, success.successUrl).embeds[0].fields.length, resolved.fields.length);
  await resolveItem({ context, item:calls[0].item, success:{state:'skipped'}, resolve:() => assert.fail('unconfirmed') });
});
