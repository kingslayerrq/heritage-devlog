import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAuthorSnapshot, syncPublicAuthors } from '../scripts/content-sync-authors.mjs';

const person = { author: 'writer', discord: '123456789012345678', name: '作者', active: true };
test('public snapshot writes only generated public fields with no credentials or redirects', async t => {
  const root = mkdtempSync(join(tmpdir(), 'devlog-profile-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let options;
  const result = await syncPublicAuthors({ root, fetch: async (_url, init) => { options = init; return new Response(JSON.stringify({ people: [{ ...person, token: 'not-exported' }] })); } });
  assert.equal(result.length, 1);
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, undefined);
  const profile = JSON.parse(readFileSync(join(root, 'src/content/authors/writer.json'), 'utf8'));
  assert.equal(profile.discord, person.discord);
  assert.equal(profile.token, undefined);
});
test('public snapshot requires HTTPS except explicit loopback test mode', async () => {
  const fetch = async () => new Response(JSON.stringify({ people: [] }));
  await assert.rejects(fetchAuthorSnapshot({ url: 'http://example.com/profiles', fetch }), /HTTPS/);
  await assert.rejects(fetchAuthorSnapshot({ url: 'https://user:password@example.com/profiles', fetch }), /HTTPS/);
  await assert.rejects(fetchAuthorSnapshot({ url: 'http://localhost/profiles', allowLocalTest: true, fetch }), /HTTPS/);
  assert.deepEqual(await fetchAuthorSnapshot({ url: 'http://127.0.0.1:3000/profiles', allowLocalTest: true, fetch }), []);
});
test('public snapshot enforces both streamed size and row limits', async () => {
  await assert.rejects(fetchAuthorSnapshot({ fetch: async () => new Response(' '.repeat(1024 * 1024 + 1)) }), /1 MiB/);
  await assert.rejects(fetchAuthorSnapshot({ fetch: async () => new Response(JSON.stringify({ people: Array(1001).fill(person) })) }), /格式/);
});
test('invalid public identities are rejected before writing files', async t => {
  const root = mkdtempSync(join(tmpdir(), 'devlog-profile-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(syncPublicAuthors({ root, fetch: async () => new Response(JSON.stringify({ people: [{ ...person, author: '../escape' }] })) }), /author ID/);
});
