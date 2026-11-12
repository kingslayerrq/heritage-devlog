import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncAuthorProfiles } from './content-profiles.mjs';

export const DEFAULT_PUBLIC_API = 'https://dispatch.kingslayerrq.me/api/devlog-authors';
const MAX_BYTES = 1024 * 1024;
export async function fetchAuthorSnapshot({ url = DEFAULT_PUBLIC_API, fetch = globalThis.fetch, allowLocalTest = false } = {}) {
  const parsed = new URL(url);
  const localTest = allowLocalTest && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if ((!localTest && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.hash) throw new Error('作者资料接口必须使用无凭据的 HTTPS 地址。');
  const response = await fetch(parsed.href, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('作者资料同步失败（HTTP ' + response.status + '）。可继续离线检查文章，GitHub 会重新验证身份。');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('作者资料响应超过 1 MiB。');
  if (!response.body) throw new Error('作者资料响应为空。');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error('作者资料响应超过 1 MiB。');
    chunks.push(Buffer.from(chunk));
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || !Array.isArray(data.people) || data.people.length > 1000) throw new Error('作者资料格式无效。');
  return data.people;
}

export async function syncPublicAuthors({ root = process.cwd(), url = process.env.DEVLOG_PUBLIC_API_URL || DEFAULT_PUBLIC_API, fetch, allowLocalTest = false } = {}) {
  const people = await fetchAuthorSnapshot({ url, fetch, allowLocalTest });
  return syncAuthorProfiles({ root, people });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const url = process.argv.slice(2).find(arg => !arg.startsWith('--'));
    const profiles = await syncPublicAuthors({ ...(url ? { url } : {}), allowLocalTest: process.argv.includes('--allow-local-test') });
    console.log('已同步 ' + profiles.length + ' 位作者。生成资料仅用于本地预览，不要提交作者 JSON。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
