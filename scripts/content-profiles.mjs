// Public identity snapshots are generated from the bot registry, never from a contributor branch.
import { mkdirSync, writeFileSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const AUTHOR_ID = /^[a-z][a-z0-9-]{0,79}$/;
export const DISCORD_ID = /^\d{15,22}$/;
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export const DEMO_AUTHORS = new Set(['heritage-team', 'sample-author']);

export function trustedAvatar(value, platform = 'discord') {
  if (value === null || value === undefined || value === '') return undefined;
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid platform avatar URL.'); }
  const hosts = platform === 'github' ? ['avatars.githubusercontent.com'] : ['cdn.discordapp.com', 'media.discordapp.net'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw new Error('Avatar must use the platform HTTPS CDN.');
  return url.href;
}

export function authorProfile(person) {
  if (!person || !AUTHOR_ID.test(person.author || '') || DEMO_AUTHORS.has(person.author)) throw new Error('Invalid registered author ID.');
  if (typeof person.discord !== 'string' || !DISCORD_ID.test(person.discord)) throw new Error('A registered author needs a verified Discord ID.');
  if (typeof person.name !== 'string' || !person.name.trim() || person.name.length > 100) throw new Error('A registered author needs a platform display name.');
  const profile = { name: person.name, discord: person.discord, generated: true, active: person.active !== false };
  const avatar = trustedAvatar(person.avatarUrl);
  if (avatar) profile.avatar = avatar;
  if (person.github !== undefined && person.github !== null) {
    if (!GITHUB_LOGIN.test(person.github) || !Number.isSafeInteger(person.githubId) || person.githubId < 1) throw new Error('A GitHub connection needs both a verified ID and a valid current login.');
    profile.github = person.github;
    profile.githubId = person.githubId;
  }
  return profile;
}

export function profilesFromPeople(people) {
  if (!Array.isArray(people) || people.length > 1000) throw new Error('The author registry must contain at most 1000 members.');
  const authors = new Set(), discord = new Set(), github = new Set();
  return people.map(person => {
    const profile = authorProfile(person);
    if (authors.has(person.author) || discord.has(profile.discord) || (profile.githubId && github.has(profile.githubId))) throw new Error('The author registry contains duplicate platform identities.');
    authors.add(person.author); discord.add(profile.discord); if (profile.githubId) github.add(profile.githubId);
    return { id: person.author, ...profile };
  });
}

/** Writes only generated public fields; private grant/device-flow data never enters the site tree. */
export function syncAuthorProfiles({ root, people }) {
  const profiles = profilesFromPeople(people);
  const directory = join(root, 'src/content/authors');
  for (const part of ['src', 'src/content', 'src/content/authors']) {
    const path = join(root, part);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Author directories must not be symbolic links.');
  }
  mkdirSync(directory, { recursive: true });
  for (const { id, ...data } of profiles) {
    const path = join(directory, `${id}.json`);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Author profiles must not be symbolic links.');
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  return profiles;
}
