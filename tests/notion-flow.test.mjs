import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compileNotionSnapshot, contentDigest } from '../scripts/notion-content.mjs';

// Real Git trees, the converter and Astro builds; all external mutations use fixture receipts.
test('Discord-only Notion content publishes an image, edits its stable URL, and rejects a changed source before merge', { timeout: 240000 }, async () => {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'heritage-notion-flow-'));
  const originalCwd = process.cwd(), originalFetch = globalThis.fetch, originalEnv = { ...process.env }, originalExitCode = process.exitCode;
  const ignored = new Set(['.git', 'node_modules', '.astro', 'dist', '.native', 'tests']);
  // Copy trusted site code, never live articles, identity snapshots or author media.
  const authoredDirectories = new Set([join(source, 'src', 'content', 'posts'), join(source, 'src', 'content', 'authors'), join(source, 'public', 'media')]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=', 'base64');
  const repo = 'kingslayerrq/heritage-devlog', pageId = 'a'.repeat(32), articlePath = 'src/content/posts/2026-11-11-notion-flow.md';
  const people = [
    { author: 'notion-writer', discord: '123456789012345678', name: 'Notion Writer', active: true },
    { author: 'fixture-owner', discord: '323456789012345678', github: 'kingslayerrq', githubId: 22969898, name: 'Owner', active: true },
  ];
  try {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith('.env') || entry.name.endsWith('.log')) continue;
      cpSync(join(source, entry.name), join(fixture, entry.name), { recursive: true,
        filter: path => !authoredDirectories.has(path) });
    }
    process.chdir(fixture);
    const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main'); git('config', 'user.name', 'Publishing App Fixture'); git('config', 'user.email', 'app@example.invalid');
    git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', '/dev/null'); git('remote', 'add', 'origin', fixture);
    git('add', '.'); git('commit', '-m', 'trusted site fixture');
    let main = git('rev-parse', 'HEAD'), previous = main, current, checkId = 0, sourceChanged = false, number = 0;
    const records = new Map(), pulls = new Map(), events = [], checks = [], results = [], receipts = new Map(), requests = [];
    const eventFile = join(fixture, 'request.json');
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const pullFor = branch => {
      const pull = pulls.get(branch);
      return pull && { ...pull, base: { ref: 'main', sha: main, repo: { full_name: repo } } };
    };
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input), body = options.body ? JSON.parse(options.body) : {};
      if (url.hostname === 'fixture.invalid') {
        requests.push(body);
        if (body.action === 'people') return response({ people });
        if (body.action === 'notion-authorize') {
          const reserved = records.get(body.id);
          if (!reserved || reserved.head !== body.head || (body.phase !== 'deploy' && sourceChanged)) return response({ error: 'Source changed' }, 409);
          return response({ source: reserved, people });
        }
        if (body.action === 'notion-result') {
          const reserved = records.get(body.id); assert.ok(reserved); assert.equal(body.head, reserved.head); results.push(body);
          if (body.outcome === 'merged') { reserved.state = 'merged'; reserved.mergeRevision = body.revision; }
          else if (body.outcome === 'published') { assert.ok(reserved.mergeRevision); reserved.state = 'published'; reserved.revision = body.revision; reserved.url = body.url; }
          else if (body.outcome === 'failed') reserved.state = reserved.mergeRevision ? 'merged' : 'failed';
          else throw new Error('Unexpected result ' + body.outcome);
          return response({ state: reserved.state });
        }
        if (body.action === 'reserve-report') {
          const old = receipts.get(body.key);
          if (old) return response({ state: old.state, messageId: old.messageId });
          receipts.set(body.key, { state: 'pending' }); return response({ state: 'reserved', reservation: 'f'.repeat(64) });
        }
        if (body.action === 'complete-report') { receipts.set(body.key, { state: body.outcome, messageId: body.messageId }); return response({ state: body.outcome }); }
        throw new Error('Unexpected integration action ' + body.action);
      }
      if (url.hostname === 'discord.com') { events.push(body); return response({ id: String(423456789012345678n + BigInt(events.length)) }); }
      if (url.hostname !== 'api.github.com') throw new Error('Unexpected network request ' + url.hostname);
      const route = url.pathname.replace('/repos/' + repo, '');
      if (route.startsWith('/git/ref/heads/')) {
        const branch = decodeURIComponent(route.slice('/git/ref/heads/'.length));
        return response({ object: { sha: branch === 'main' ? main : records.get(branch.slice('notion/'.length))?.head } });
      }
      if (route.startsWith('/compare/')) {
        const [base, head] = route.slice('/compare/'.length).split('...');
        const ahead = Number(git('rev-list', '--count', base + '..' + head)), behind = Number(git('rev-list', '--count', head + '..' + base));
        return response({ status: ahead ? behind ? 'diverged' : 'ahead' : behind ? 'behind' : 'identical' });
      }
      if (route === '/pulls' && options.method === 'POST') {
        const record = records.get(body.head.slice('notion/'.length));
        pulls.set(body.head, { number: ++number, state: 'open', draft: false, head: { sha: record.head, ref: body.head, repo: { full_name: repo } } });
        return response(pullFor(body.head), 201);
      }
      if (route === '/pulls') { const branch = url.searchParams.get('head')?.split(':').slice(1).join(':'); const pull = pullFor(branch); return response(pull ? [pull] : []); }
      if (/^\/pulls\/\d+$/.test(route)) return response([...pulls.values()].map(pull => pullFor(pull.head.ref)).find(pull => pull.number === Number(route.split('/')[2])));
      if (route === '/check-runs' && options.method === 'POST') return response({ id: ++checkId }, 201);
      if (route.startsWith('/check-runs/') && options.method === 'PATCH') { checks.push(body); return response(body); }
      if (route === '/branches/main/protection') return response({ required_status_checks: { strict: true, checks: [{ context: 'Devlog content', app_id: 9 }] }, required_pull_request_reviews: { required_approving_review_count: 0 } });
      if (/^\/pulls\/\d+\/merge$/.test(route)) {
        assert.equal(sourceChanged, false, 'Stale source must never reach the merge API.');
        const pull = [...pulls.values()].find(pull => pull.number === Number(route.split('/')[2])); assert.equal(body.sha, pull.head.sha);
        git('switch', 'main'); git('merge', '--squash', pull.head.sha); git('commit', '-m', 'reviewed Notion publication'); main = git('rev-parse', 'HEAD');
        Object.assign(pull, { state: 'closed', merged_at: '2026-11-11T12:00:00Z', merge_commit_sha: main });
        return response({ merged: true, sha: main });
      }
      if (route.startsWith('/commits/') && route.endsWith('/pulls')) return response([...pulls.values()].filter(pull => pull.merge_commit_sha === route.split('/')[2]).map(pull => pullFor(pull.head.ref)));
      if (route === '/deployments') return response([{ id: 1, sha: previous }]);
      if (route === '/deployments/1/statuses') return response([{ state: 'success' }]);
      throw new Error('Unexpected GitHub API route ' + options.method + ' ' + route);
    };
    Object.assign(process.env, {
      DEVLOG_APP_TOKEN: 'fixture-app', DEVLOG_APP_ID: '9', GITHUB_TOKEN: 'fixture-read',
      DEVLOG_INTEGRATION_URL: 'https://fixture.invalid', DEVLOG_INTEGRATION_TOKEN: 'fixture-integration',
      DISCORD_DEVLOG_ALERTS_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/alerts',
      DISCORD_DEVLOG_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/publications',
      GITHUB_REPOSITORY: repo, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_PATH: eventFile, GITHUB_RUN_ID: '42',
      GITHUB_OUTPUT: join(fixture, 'output.txt'), GITHUB_EVENT_NAME: 'workflow_dispatch', NPM_CONFIG_OFFLINE: 'true',
      NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false', SITE_URL: 'https://devlog.example.test', BASE_PATH: '/heritage-devlog',
    });
    const pipeline = await import(pathToFileURL(resolve(source, 'scripts/native-pipeline.mjs')).href + '?notion-fixture-flow');
    const content = (type, text) => ({ id: contentDigest(type + text).slice(0, 32), type, [type]: { rich_text: [{ type: 'text', text: { content: text } }] } });
    const candidate = async (id, text, previousManifest = []) => {
      git('switch', 'main'); const base = main, branch = 'notion/' + id; git('switch', '-c', branch);
      const snapshot = { id, pageId, entryId: 'notion-' + pageId, sourceUrl: 'https://www.notion.so/' + pageId, actorAuthor: people[0].author,
        path: articlePath, previousManifest, metadata: { title: 'Building the member terminal', date: '2026-11-11', discipline: 'tech', authors: [people[0].author], summary: 'A fixture-backed integration check.', tags: ['terminal'] },
        blocks: [content('heading_1', 'What changed'), content('paragraph', text), { id: 'd'.repeat(32), type: 'image', image: { type: 'file',
          file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/fixture/image.png?signature=private-expiring-value' }, caption: [{ type: 'text', text: { content: 'A one-pixel fixture image.' } }] } }] };
      snapshot.sourceDigest = contentDigest({ metadata: snapshot.metadata, blocks: snapshot.blocks });
      const compiled = await compileNotionSnapshot(snapshot, { download: async () => ({ bytes: png, contentType: 'image/png' }) });
      for (const file of [compiled.post, ...compiled.assets]) { mkdirSync(dirname(file.path), { recursive: true }); writeFileSync(file.path, file.content ?? file.bytes); git('add', file.path); }
      git('commit', '-m', 'Import exact reviewed Notion snapshot');
      current = { id, pageId, path: snapshot.path, sourceUrl: snapshot.sourceUrl, sourceDigest: snapshot.sourceDigest, actorAuthor: snapshot.actorAuthor, previousManifest,
        head: git('rev-parse', 'HEAD'), base, branch, manifest: compiled.manifest, digest: compiled.digest, state: 'bound' };
      records.set(id, current); assert.equal(git('rev-parse', current.head + '^'), base);
      assert.equal(compiled.assets.length, 1); assert.ok(!compiled.post.content.includes('private-expiring-value'));
      return compiled;
    };
    const prepareAndBuild = async () => {
      writeFileSync(eventFile, JSON.stringify({ inputs: { branch: current.branch }, sender: { id: 999, login: 'publishing-app[bot]' } }));
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'; git('switch', 'main');
      const target = join(fixture, '.native', 'project');
      if (existsSync(target)) { assert.ok(resolve(target).startsWith(resolve(fixture) + sep)); rmSync(target, { recursive: true, force: true }); }
      await pipeline.prepare();
      const context = JSON.parse(readFileSync('.native/context.json'));
      assert.equal(context.actor.id, 0); assert.equal(context.actorAuthor, people[0].author); assert.equal(context.accepted, true);
      assert.ok(!JSON.stringify(context).includes('private-expiring-value'));
      pipeline.build({ stdio: 'pipe' });
      assert.equal(JSON.parse(readFileSync('.native/result.json')).ok, true, readFileSync('.native/result.json', 'utf8'));
      process.env.BUILD_RESULT = 'success';
    };
    const deploy = async () => {
      process.env.GITHUB_EVENT_NAME = 'push'; process.env.GITHUB_SHA = main;
      writeFileSync(eventFile, JSON.stringify({ sender: { id: 999, login: 'publishing-app[bot]' } }));
      await pipeline.prepareDeployment(); process.env.DEPLOY_RESULT = 'success'; await pipeline.reportDeployment();
    };
    const first = await candidate('1'.repeat(64), 'The original wording is preserved.');
    await prepareAndBuild(); await pipeline.finalize();
    assert.equal(current.state, 'merged'); assert.equal(current.mergeRevision, main);
    await deploy(); const firstUrl = current.url;
    assert.equal(current.state, 'published'); assert.equal(current.url, 'https://devlog.example.test/heritage-devlog/posts/2026-11-11-notion-flow/');
    assert.equal(checks.at(-1).conclusion, 'success');
    const rendered = readFileSync('.native/project/dist/posts/2026-11-11-notion-flow/index.html', 'utf8');
    assert.match(rendered, /The original wording is preserved/); assert.ok(rendered.includes(first.assets[0].path.slice('public'.length)));
    assert.ok(existsSync(join('.native/project/dist', first.assets[0].path.slice('public/'.length))));
    const publications = () => events.filter(event => event.embeds[0].title.includes('已发布'));
    assert.equal(publications().length, 1); assert.deepEqual(publications()[0].allowed_mentions.users, [people[0].discord]);
    await pipeline.reportDeployment(); assert.equal(publications().length, 1, 'Publication reports are receipt-idempotent.');
    previous = main;
    const second = await candidate('2'.repeat(64), 'The edited wording stays at the same public URL.', first.manifest);
    await prepareAndBuild(); await pipeline.finalize(); await deploy();
    assert.equal(current.url, firstUrl); assert.deepEqual(second.assets, first.assets);
    assert.equal(events.filter(event => event.embeds[0].title.includes('已更新')).length, 1); assert.equal(publications().length, 1);
    assert.ok(readFileSync('.native/project/dist/posts/2026-11-11-notion-flow/index.html', 'utf8').includes('The edited wording stays'));
    assert.deepEqual([...new Set(results.filter(result => result.outcome === 'merged').map(result => result.id))], ['1'.repeat(64), '2'.repeat(64)]);
    previous = main; await candidate('3'.repeat(64), 'This version must not publish after the source changes.', second.manifest);
    await prepareAndBuild(); sourceChanged = true; const reviewedMain = main;
    await assert.rejects(pipeline.finalize(), /validation or build failed/);
    assert.equal(main, reviewedMain); assert.equal(current.state, 'failed'); assert.equal(checks.at(-1).conclusion, 'failure');
    assert.ok(checks.at(-1).output.annotations.length === 0 || checks.at(-1).output.summary.includes('Notion'));
    assert.equal(events.filter(event => event.embeds[0].title.includes('未通过')).length, 1);
    assert.ok(requests.some(request => request.action === 'notion-authorize' && request.phase === 'deploy'));
    assert.equal(publications().length, 1);
  } finally {
    globalThis.fetch = originalFetch; process.chdir(originalCwd); process.exitCode = originalExitCode;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    if (fixture.startsWith(join(tmpdir(), 'heritage-notion-flow-'))) rmSync(fixture, { recursive: true, force: true });
  }
});
