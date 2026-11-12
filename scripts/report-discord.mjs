import { reportKey, OWNER_ID } from './native-api.mjs';

const text = (value, max = 800) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/@/g, '@\u200b').slice(0, max);
const markdown = (value, max) => text(value, max).replace(/[\\\x60*_~|<>\[\]]/g, '\\$&');
const labels = {
  validation: ['\u{1F534} 内容检查未通过', 0xe74c3c],
  warning: ['\u{1F7E1} 内容检查提醒', 0xf1c40f],
  policy: ['\u{1F534} 修改范围不允许', 0xe74c3c],
  publish: ['\u{1F7E2} 开发日志已发布', 0x2ecc71],
  edit: ['\u{1F535} 开发日志已更新', 0x3498db],
  deployment: ['\u{1F534} 发布流程失败', 0xe74c3c],
};
export function reportRecipients({ people, actorId, authors = [], owner = false }) {
  const ids = new Set();
  const actor = people.find(person => Number(person.githubId) === Number(actorId));
  if (actor) ids.add(actor.discord);
  for (const author of authors) {
    const person = people.find(candidate => candidate.author === author);
    if (person) ids.add(person.discord);
  }
  if (owner || !actor) {
    const person = people.find(candidate => Number(candidate.githubId) === OWNER_ID);
    if (person) ids.add(person.discord);
  }
  return [...ids].filter(id => /^\d{15,22}$/.test(id)).slice(0, 30);
}
const githubLink = (repo, path = '') => 'https://github.com/' + repo + path;
export function makeReport({ kind, people = [], actorId, actorLogin, authors = [], title, issues = [], repo, revision, pr, runId, url, summary, cover, owner = false }) {
  if (!labels[kind] || !/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Invalid report metadata.');
  const [label, color] = labels[kind];
  const recipients = reportRecipients({ people, actorId, authors, owner: owner || ['policy', 'deployment'].includes(kind) });
  const author = people.find(person => person.author === authors[0]) || people.find(person => Number(person.githubId) === Number(actorId));
  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  const fields = [
    { name: '提交者', value: markdown(actorLogin || '自动发布'), inline: true },
    { name: '版本', value: '[' + revision.slice(0, 7) + '](' + githubLink(repo, '/commit/' + revision) + ')', inline: true },
  ];
  if (issues.length) fields.push({ name: '检查结果', value: errors + ' 个错误 · ' + warnings + ' 个提醒', inline: true });
  for (const issue of issues.slice(0, 6)) {
    const path = text(issue.path || '发布流程', 160);
    fields.push({ name: ((issue.severity === 'error' ? '❌ ' : '⚠️ ') + path + (issue.line ? ':' + issue.line : '')).slice(0, 256),
      value: (markdown(issue.message, 250) + (issue.fix ? '\n**处理：**' + markdown(issue.fix, 150) : '')).slice(0, 450) });
  }
  if (issues.length > 6) fields.push({ name: '更多详情', value: '还有 ' + (issues.length - 6) + ' 项，请打开检查记录查看完整结果。' });
  const links = [
    pr ? '[查看修改](' + githubLink(repo, '/pull/' + pr) + ')' : null,
    runId ? '[检查记录](' + githubLink(repo, '/actions/runs/' + runId) + ')' : null,
    url ? '[阅读日志](' + new URL(url).href + ')' : null,
  ].filter(Boolean).join(' · ');
  fields.push({ name: '链接', value: links || '[查看版本](' + githubLink(repo, '/commit/' + revision) + ')' });
  const embed = { title: label + (title ? ' · ' + text(title, 100) : ''), color,
    description: markdown(summary || (kind === 'policy' ? '请撤回列出的非内容文件修改，再推送分支重试。分支内容未被自动删除或回滚。' : ['publish', 'edit'].includes(kind) ? '此版本已完成网站部署。' : '错误会阻止发布；提醒不会阻止发布。'), 500),
    fields, footer: { text: 'Heritage · 开发日志' }, timestamp: new Date().toISOString() };
  if (author) embed.author = { name: text(author.name, 100), ...(author.avatarUrl && /^https:\/\/cdn\.discordapp\.com\//.test(author.avatarUrl) ? { icon_url: author.avatarUrl } : {}) };
  if (cover && url) { const image = new URL(cover, url); if (image.origin === new URL(url).origin && /\.(png|jpe?g|webp|gif)$/i.test(image.pathname)) embed.image = { url: image.href }; }
  return { content: recipients.map(id => '<@' + id + '>').join(' '), embeds: [embed], allowed_mentions: { parse: [], users: recipients } };
}

/** Reserve before posting. A missing Discord receipt is ambiguous, never automatically resend. */
export async function deliverReport({ integration, webhook, repo, kind, revision, scope, payload, fetch = globalThis.fetch }) {
  if (!webhook) throw new Error('Discord webhook is not configured.');
  const url = new URL(webhook);
  if (!['discord.com', 'discordapp.com'].includes(url.hostname) || url.protocol !== 'https:' || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w.-]+$/.test(url.pathname)) throw new Error('Invalid Discord webhook configuration.');
  url.searchParams.set('wait', 'true');
  const storageKind = kind === 'warning' ? 'validation' : kind;
  const key = reportKey(repo, kind, scope, revision);
  const reserved = await integration({ action: 'reserve-report', key, kind: storageKind, revision });
  if (reserved.state === 'sent') return { state: 'sent', duplicate: true, messageId: reserved.messageId };
  if (reserved.state !== 'reserved' || !reserved.reservation) throw new Error('A previous Discord delivery is pending or uncertain; inspect it before retrying. REPORT_KEY=' + key);
  const complete = async outcome => {
    try { return await integration({ action: 'complete-report', key, reservation: reserved.reservation, ...outcome }); }
    catch { throw new Error('Report state could not be confirmed. Inspect Discord before retrying. REPORT_KEY=' + key); }
  };
  let response;
  try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) }); }
  catch { await complete({ outcome: 'uncertain' }); throw new Error('Discord delivery is uncertain; no automatic resend. REPORT_KEY=' + key); }
  if (!response.ok) {
    await complete({ outcome: response.status >= 400 && response.status < 500 ? 'failed' : 'uncertain' });
    throw new Error('Discord rejected the report (' + response.status + '); check delivery state before retrying. REPORT_KEY=' + key);
  }
  const receipt = await response.json().catch(() => null);
  if (typeof receipt?.id !== 'string' || !/^\d{17,20}$/.test(receipt.id)) { await complete({ outcome: 'uncertain' }); throw new Error('Discord returned no message receipt; no automatic resend. REPORT_KEY=' + key); }
  await complete({ outcome: 'sent', messageId: receipt.id });
  return { state: 'sent', messageId: receipt.id };
}
