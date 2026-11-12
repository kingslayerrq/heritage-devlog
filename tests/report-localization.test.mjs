import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeReport } from '../scripts/report-discord.mjs';
import { localizeReportIssue } from '../scripts/report-localization.mjs';

const repo = 'kingslayerrq/heritage-devlog', revision = 'a'.repeat(40);
const page = 'https://www.notion.so/' + 'b'.repeat(32), block = page + '#' + 'c'.repeat(32);
const path = 'src/content/posts/2026-11-12-English-title.md';
const people = [{ author: 'writer', discord: '123456789012345678', name: 'English Display Name', active: true }];
const report = extra => makeReport({ repo, revision, kind: 'validation', actorId: 0, actorAuthor: 'writer', actorLogin: people[0].name, people, authors: ['writer'], title: 'Original English Title', summary: 'The original English article summary.', sourceUrl: page, runId: 123, ...extra });
const details = payload => payload.embeds[0].fields.find(field => field.name.startsWith('❌') || field.name.startsWith('⚠️')).value;

test('all report kinds preserve authored text and identities while localizing generated explanations', () => {
  for (const kind of ['validation', 'warning', 'policy', 'deployment', 'publish', 'edit']) {
    const payload = report({ kind, issues: [{ severity: kind === 'warning' ? 'warning' : 'error', code: 'notion.empty', path, line: 7,
      message: 'The article body is empty.', fix: 'Correct this Notion block and request publication again. Source: ' + block, sourceUrl: block }] });
    const embed = payload.embeds[0];
    assert.match(embed.title, /[\p{Script=Han}]/u);
    assert.ok(embed.title.endsWith('Original English Title'));
    assert.equal(embed.description, 'The original English article summary.');
    assert.equal(embed.author.name, people[0].name);
    assert.equal(embed.fields[0].value, people[0].name);
    assert.ok(embed.fields.some(field => field.name.includes(path + ':7')));
    assert.match(details(payload), /文章正文为空/);
    assert.match(details(payload), /请修正此 Notion 内容块/);
    assert.ok(details(payload).includes('[打开 Notion 内容块](' + block + ')'));
    assert.ok(!JSON.stringify(payload).includes('Open Notion block'));
    assert.ok(!JSON.stringify(payload).includes('The article body is empty'));
    assert.deepEqual(payload.allowed_mentions, { parse: [], users: [people[0].discord] });
  }
});

test('every literal converter diagnostic has a specific Chinese translation', () => {
  const source = readFileSync(new URL('../scripts/notion-content.mjs', import.meta.url), 'utf8');
  const diagnostics = [...source.matchAll(/\b(?:fail|warn)\('([^']+)', '([^']+)'/g)];
  assert.ok(diagnostics.length > 40);
  for (const [, code, message] of diagnostics) {
    const translated = localizeReportIssue({ code: 'notion.' + code, message }).message;
    assert.notEqual(translated, message, message);
    assert.match(translated, /\p{Script=Han}/u, message);
    assert.ok(!translated.startsWith('检查未通过，请打开检查记录'), message);
  }
});

test('all explicit converter correction instructions have Chinese guidance and preserve source links', () => {
  const source = readFileSync(new URL('../scripts/notion-content.mjs', import.meta.url), 'utf8');
  const instructions = [...source.matchAll(/\b(?:fail|warn)\('[^']+', '[^']+',\s*(?:block|row|undefined),\s*'([^']+)'\)/g)].map(match => match[1]);
  instructions.push(source.match(/const fail = .*?fix = '([^']+)'/)[1]);
  assert.ok(instructions.length > 12);
  for (const fix of instructions) {
    const translated = localizeReportIssue({ code: 'notion.test', message: '原文', fix: fix + ' Source: ' + block }).fix;
    assert.match(translated, /\p{Script=Han}/u, fix);
    assert.ok(!translated.startsWith('请打开检查记录，修正对应问题'), fix);
    assert.ok(translated.endsWith('来源：' + block), fix);
  }
});

test('shared diagnostic codes keep reason-specific distinctions and warning meaning', () => {
  const columnWarning = localizeReportIssue({ code: 'notion.columns', severity: 'warning', message: 'Notion columns are shown sequentially on the website.', fix: 'Check that the reading order still makes sense.' });
  const columnError = localizeReportIssue({ code: 'notion.columns', severity: 'error', message: 'A column layout contains an unexpected child.' });
  assert.match(columnWarning.message, /按顺序显示/);
  assert.match(columnWarning.fix, /阅读顺序/);
  assert.match(columnError.message, /不支持的子内容块/);
  assert.notEqual(columnWarning.message, columnError.message);
  const sourceError = localizeReportIssue({ code: 'notion.source', message: 'Choose Tech, Art, Design, Audio, Narrative, or Production in Discipline.', fix: 'Correct the Notion page, then choose Ready to publish or Ready to update again.' });
  assert.match(sourceError.message, /请在 Discipline 中选择/);
  assert.match(sourceError.message, /tech、art、design、audio、narrative、production/);
  assert.match(sourceError.fix, /Ready to publish/);
  assert.match(localizeReportIssue({ code: 'notion.source', message: 'The person who submits this page must first register in Discord and link their Notion account.' }).message, /注册并绑定/);
  assert.match(localizeReportIssue({ code: 'notion.source', message: 'Remove Notion mentions from Name and Summary before publishing.' }).message, /移除 Name 和 Summary/);
});

test('setup stages, merge errors, registry diagnostics and parser reasons are Chinese', () => {
  assert.equal(localizeReportIssue({ message: '自动发布流程未能完成此阶段：notion-import' }).message, '自动发布流程未能完成此阶段：导入 Notion');
  assert.match(localizeReportIssue({ code: 'merge-precondition', message: 'GitHub request failed (403).' }).message, /GitHub 请求失败（HTTP 403）/);
  assert.match(localizeReportIssue({ code: 'identity.registry', message: 'A registered author needs a verified Discord ID.' }).message, /缺少已验证的 Discord 标识/);
  assert.equal(localizeReportIssue({ code: 'metadata.yaml', message: 'YAML 格式错误：duplicated mapping key' }).message, 'YAML 格式错误：字段名称重复');
  const yaml = localizeReportIssue({ code: 'metadata.yaml', message: 'YAML 格式错误：unidentified alias "OriginalReference"' }).message;
  assert.match(yaml, /YAML 格式错误：请检查/);
  assert.ok(yaml.includes('"OriginalReference"'));
  assert.ok(!yaml.includes('unidentified alias'));
  const payload = report({ actorId: 0, actorAuthor: undefined, actorLogin: 'Notion import', people: [], authors: [] });
  assert.equal(payload.embeds[0].fields[0].value, 'Notion 导入');
});

test('unknown diagnostics use Chinese guidance and keep source locations without echoing raw exceptions', () => {
  const payload = report({ issues: [{ code: 'future.check', severity: 'error', path, line: 19, message: 'Unexpected English service diagnostic', fix: 'Untranslated English instructions', sourceUrl: block }] });
  assert.match(details(payload), /检查未通过/);
  assert.ok(details(payload).includes('future.check'));
  assert.match(details(payload), /打开检查记录/);
  assert.ok(!JSON.stringify(payload).includes('Unexpected English'));
  assert.ok(!JSON.stringify(payload).includes('Untranslated English'));
  assert.ok(details(payload).includes(block));
});

test('native Chinese diagnostics and quoted source references remain unchanged', () => {
  const issue = { code: 'post.title', message: '不支持字段："OriginalField"。', fix: '请检查 source.md 中的字段。', path };
  assert.deepEqual(localizeReportIssue(issue), issue);
});
