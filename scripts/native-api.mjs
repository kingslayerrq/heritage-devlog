import { createHash } from 'node:crypto';

export const OWNER_ID = 22969898;
export const CHECK_NAME = 'Devlog content';
export const shaPattern = /^[a-f0-9]{40}$/;
export const reportKey = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function createGithub({ token = process.env.DEVLOG_APP_TOKEN, repo = process.env.GITHUB_REPOSITORY, fetch = globalThis.fetch } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !token) throw new Error('GitHub repository and App token are required.');
  const api = async (method, path, body) => {
    const shaComparison = /^\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}\?per_page=1$/.test(path);
    if (!path.startsWith('/') || (path.includes('..') && !shaComparison)) throw new Error('Invalid GitHub API path.');
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Object.assign(new Error(`GitHub request failed (${response.status}).`), { status: response.status });
    return response.status === 204 ? null : response.json();
  };
  return { api, repo };
}

export function createIntegration({ origin = process.env.DEVLOG_INTEGRATION_URL, token = process.env.DEVLOG_INTEGRATION_TOKEN, fetch = globalThis.fetch } = {}) {
  const url = new URL('/api/devlog-integration', origin);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Devlog integration requires HTTPS.');
  if (!token) throw new Error('Devlog integration token is missing.');
  return async body => {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(['notion-next', 'notion-authorize', 'notion-bind'].includes(body.action) ? 120000 : 20000) });
    if (!response.ok) throw Object.assign(new Error(`Devlog integration request failed (${response.status}).`), { status: response.status });
    return response.json();
  };
}

export function verifiedActor(people, actorId) {
  return people.find(person => person.active === true && Number(person.githubId) === Number(actorId));
}
export function requirePeople(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid trusted author registry.');
  const authors = new Set(), discord = new Set(), github = new Set();
  for (const person of value) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(person.author || '') || !/^\d{15,22}$/.test(person.discord || '') || typeof person.name !== 'string' ||
      typeof person.active !== 'boolean' || authors.has(person.author) || discord.has(person.discord)) throw new Error('Invalid trusted author identity.');
    if (person.githubId !== undefined && (!Number.isSafeInteger(person.githubId) || person.githubId < 1 || github.has(person.githubId))) throw new Error('Invalid GitHub identity binding.');
    authors.add(person.author); discord.add(person.discord); if (person.githubId) github.add(person.githubId);
  }
  return value;
}
