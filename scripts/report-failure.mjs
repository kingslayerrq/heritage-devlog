// Deliberately imports no npm packages: it also reports dependency-install failures.
import { readFileSync, existsSync } from 'node:fs';
import { createIntegration, requirePeople, shaPattern } from './native-api.mjs';
import { makeReport, deliverReport } from './report-discord.mjs';

export async function failureReport({ env = process.env, integration = createIntegration(), fetch = globalThis.fetch } = {}) {
  if (existsSync('.native/reported.json') && ['validation', 'policy', 'deployment'].includes(JSON.parse(readFileSync('.native/reported.json', 'utf8')).kind)) return { skipped: true };
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  let context;
  for (const path of ['.native/context.json', '.native/deploy.json']) {
    if (existsSync(path)) { context = JSON.parse(readFileSync(path, 'utf8')); break; }
  }
  const head = context?.head || event.workflow_run?.head_sha || env.GITHUB_SHA;
  if (!shaPattern.test(head || '')) throw new Error('No verified revision is available for a failure report.');
  const people = requirePeople((await integration({ action: 'people' })).people);
  const actor = context?.actor || event.workflow_run?.actor || event.sender || {};
  const kind = 'deployment', scope = 'pipeline:' + (env.REPORT_PHASE || env.GITHUB_JOB || 'setup');
  const payload = makeReport({ kind, people, repo: env.GITHUB_REPOSITORY, revision: head, actorId: actor.id, actorLogin: actor.login,
    pr: context?.pr, authors: context?.authors || [], runId: Number(env.GITHUB_RUN_ID), owner: true,
    issues: [{ severity: 'error', path: '', line: 1, message: '自动发布流程未能完成此阶段：' + (env.REPORT_PHASE || env.GITHUB_JOB || 'setup'),
      fix: '打开检查记录查看具体失败原因。此报告不表示文章已经上线；修复配置或错误后重新运行。' }] });
  return deliverReport({ integration, webhook: env.DISCORD_DEVLOG_ALERTS_WEBHOOK, repo: env.GITHUB_REPOSITORY, kind, revision: head, scope, payload, fetch });
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/report-failure.mjs')) {
  try { await failureReport(); }
  catch { console.error('Discord failure report could not be confirmed. The GitHub run remains failed. If the durable integration is unavailable, no untracked webhook send is attempted.'); process.exitCode = 1; }
}
