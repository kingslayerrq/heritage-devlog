import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('fixture pipeline rejects invalid content, publishes a corrected branch, then reports an edit once', { timeout: 480000 }, async () => {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'heritage-native-flow-'));
  const originalCwd = process.cwd(), originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  const ignored = new Set(['.git', 'node_modules', '.astro', 'dist', '.native', 'tests']);
  // Copy trusted site code, never live articles, identity snapshots or author media.
  const authoredDirectories = new Set([join(source, 'src', 'content', 'posts'), join(source, 'src', 'content', 'authors'), join(source, 'public', 'media')]);
  try {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith('.env') || entry.name.endsWith('.log')) continue;
      cpSync(join(source, entry.name), join(fixture, entry.name), {
        recursive: true,
        filter: path => !authoredDirectories.has(path),
      });
    }
    process.chdir(fixture);
    const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', '/dev/null'); git('remote', 'add', 'origin', fixture);
    git('add', '.'); git('commit', '-m', 'trusted site fixture');
    let main = git('rev-parse', 'HEAD'), previous = main, head, mergedPull, pullOpen = false, checkId = 0;
    const repo = 'kingslayerrq/heritage-devlog', branch = 'devlog/fixture';
    git('switch', '-c', branch);
    const path = 'src/content/posts/2026-11-11-fixture.md';
    const people = [
      { author: 'fixture-writer', discord: '123456789012345678', github: 'fixture-writer', githubId: 123, name: '测试作者', active: true },
      { author: 'fixture-artist', discord: '223456789012345678', name: '测试美术', active: true },
      { author: 'fixture-owner', discord: '323456789012345678', github: 'kingslayerrq', githubId: 22969898, name: 'Owner', active: true },
    ];
    const validPost = text => '---\ntitle: 测试日志\ndate: 2026-11-11\ndiscipline: tech\nauthors: [fixture-writer, fixture-artist]\nsummary: 本地端到端测试\ntags: [测试]\n---\n\n' + text + '\n';
    const commit = text => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); git('add', path); git('commit', '-m', 'fixture content'); head = git('rev-parse', 'HEAD'); };
    const eventFile = join(fixture, 'request.json');
    const events = [], checks = [], receipts = new Map();
    const pull = () => ({ number: 1, state: pullOpen ? 'open' : 'closed', draft: false, head: { sha: head, ref: branch, repo: { full_name: repo } }, base: { ref: 'main', sha: main, repo: { full_name: repo } }, ...(mergedPull || {}) });
    const result = (data, status = 200) => new Response(JSON.stringify(data), { status });
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.hostname === 'fixture.invalid') {
        if (body.action === 'people') return result({ people });
        if (body.action === 'reserve-report') {
          const old = receipts.get(body.key);
          if (old) return result({ state: old.state, messageId: old.messageId });
          receipts.set(body.key, { state: 'pending' }); return result({ state: 'reserved', reservation: 'f'.repeat(64) });
        }
        if (body.action === 'complete-report') { receipts.set(body.key, { state: body.outcome, messageId: body.messageId }); return result({ state: body.outcome }); }
      }
      if (url.hostname === 'discord.com') {
        events.push({ url: url.pathname, body });
        return result({ id: String(423456789012345678n + BigInt(events.length)) });
      }
      if (url.hostname !== 'api.github.com') throw new Error('Unexpected network request: ' + url.hostname);
      const route = url.pathname.replace('/repos/' + repo, '');
      if (route === '/actions/runs/1') return result({ event: 'push', path: '.github/workflows/check.yml', repository: { full_name: repo }, head_repository: { full_name: repo }, head_branch: branch, head_sha: head, actor: { id: 123, login: 'fixture-writer' } });
      if (route === '/actions/runs') return result({ workflow_runs: [{ event: 'push', path: '.github/workflows/check.yml', repository: { id: 1 }, head_repository: { id: 1 }, head_branch: branch, head_sha: head, actor: { id: 123, login: 'fixture-writer' } }] });
      if (route.startsWith('/git/ref/heads/')) return result({ object: { sha: decodeURIComponent(route) === '/git/ref/heads/main' ? main : head } });
      if (route.startsWith('/compare/')) {
        const [comparisonBase, comparisonHead] = route.slice('/compare/'.length).split('...');
        const ahead = Number(git('rev-list', '--count', comparisonBase + '..' + comparisonHead));
        const behind = Number(git('rev-list', '--count', comparisonHead + '..' + comparisonBase));
        return result({ status: ahead ? behind ? 'diverged' : 'ahead' : behind ? 'behind' : 'identical' });
      }
      if (route === '/pulls' && options.method === 'POST') { pullOpen = true; mergedPull = undefined; return result(pull(), 201); }
      if (route === '/pulls') return result(pullOpen ? [pull()] : []);
      if (route === '/pulls/1') return result(pull());
      if (route === '/check-runs' && options.method === 'POST') return result({ id: ++checkId }, 201);
      if (route.startsWith('/check-runs/') && options.method === 'PATCH') { checks.push(body); return result(body); }
      if (route === '/branches/main/protection') return result({ required_status_checks: { strict: true, checks: [{ context: 'Devlog content', app_id: 9 }] }, required_pull_request_reviews: { required_approving_review_count: 0 } });
      if (route === '/pulls/1/merge') {
        assert.equal(body.sha, head);
        git('switch', 'main'); git('merge', '--squash', head); git('commit', '-m', 'reviewed fixture publication');
        main = git('rev-parse', 'HEAD'); pullOpen = false;
        mergedPull = { merged_at: new Date().toISOString(), merge_commit_sha: main };
        return result({ merged: true, sha: main });
      }
      if (route.startsWith('/commits/') && route.endsWith('/pulls')) return result([pull()]);
      if (route === '/deployments') return result([{ id: 1, sha: previous }]);
      if (route === '/deployments/1/statuses') return result([{ state: 'success' }]);
      throw new Error('Unexpected GitHub API route: ' + options.method + ' ' + route);
    };
    Object.assign(process.env, {
      DEVLOG_APP_TOKEN: 'fixture-app', DEVLOG_APP_ID: '9', GITHUB_TOKEN: 'fixture-read',
      DEVLOG_INTEGRATION_URL: 'https://fixture.invalid', DEVLOG_INTEGRATION_TOKEN: 'fixture-integration',
      DISCORD_DEVLOG_ALERTS_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/alerts',
      DISCORD_DEVLOG_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/publications',
      GITHUB_REPOSITORY: repo, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_PATH: eventFile, GITHUB_RUN_ID: '42',
      GITHUB_OUTPUT: join(fixture, 'output.txt'), GITHUB_EVENT_NAME: 'workflow_run', NPM_CONFIG_OFFLINE: 'true',
      NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false',
    });
    const pipeline = await import(pathToFileURL(resolve(source, 'scripts/native-pipeline.mjs')).href + '?fixture-flow');
    const request = async () => {
      writeFileSync(eventFile, JSON.stringify({ workflow_run: { id: 1 } }));
      process.env.GITHUB_EVENT_NAME = 'workflow_run';
      // A real Actions prepare checkout is main, even though it inspects the branch head.
      git('switch', 'main');
      await pipeline.prepare();
    };
    // A retained release branch can equal main without having a PR; it is a harmless no-op.
    head = main;
    await request();
    assert.equal(pullOpen, false); assert.equal(checkId, 0); assert.equal(events.length, 0);
    assert.ok(readFileSync(process.env.GITHUB_OUTPUT, 'utf8').includes('accepted=false'));
    git('switch', branch);
    commit(validPost('尚未发布。').replace('authors: [fixture-writer, fixture-artist]', 'authors: 17'));
    await request();
    pipeline.build({ stdio: 'pipe' });
    assert.equal(JSON.parse(readFileSync('.native/result.json')).ok, false);
    process.env.BUILD_RESULT = 'failure';
    await assert.rejects(pipeline.finalize(), /validation or build failed/);
    process.exitCode = undefined;
    assert.equal(events.length, 1);
    assert.ok(events[0].body.embeds[0].title.includes('未通过'));
    assert.equal(pullOpen, true);
    git('switch', branch); commit(validPost('中文内容通过验证。'));
    rmSync('.native/project', { recursive: true, force: true });
    await request();
    pipeline.build({ stdio: 'pipe' });
    assert.equal(JSON.parse(readFileSync('.native/result.json')).ok, true, readFileSync('.native/result.json', 'utf8'));
    process.env.BUILD_RESULT = 'success';
    await pipeline.finalize();
    assert.equal(pullOpen, false);
    assert.equal(checks.at(-1).conclusion, 'success');
    process.env.GITHUB_EVENT_NAME = 'push'; process.env.GITHUB_SHA = main;
    writeFileSync(eventFile, JSON.stringify({ sender: { id: 999, login: 'publishing-app[bot]' } }));
    await pipeline.prepareDeployment();
    process.env.DEPLOY_RESULT = 'success';
    await pipeline.reportDeployment();
    const published = events.filter(event => event.body.embeds[0].title.includes('已发布'));
    assert.equal(published.length, 1);
    assert.deepEqual(published[0].body.allowed_mentions.users, [people[0].discord, people[1].discord]);
    await pipeline.reportDeployment();
    assert.equal(events.filter(event => event.body.embeds[0].title.includes('已发布')).length, 1);
    assert.ok(existsSync('.native/project/dist/posts/2026-11-11-fixture/index.html'));
    previous = main;
    git('switch', branch); git('merge', 'main', '--no-edit'); commit(validPost('同一篇日志的更新。'));
    rmSync('.native/project', { recursive: true, force: true });
    await request(); pipeline.build({ stdio: 'pipe' }); assert.equal(JSON.parse(readFileSync('.native/result.json')).ok, true, readFileSync('.native/result.json', 'utf8'));
    await pipeline.finalize();
    process.env.GITHUB_EVENT_NAME = 'push'; process.env.GITHUB_SHA = main;
    writeFileSync(eventFile, JSON.stringify({ sender: { id: 999, login: 'publishing-app[bot]' } }));
    await pipeline.prepareDeployment(); await pipeline.reportDeployment();
    assert.equal(events.filter(event => event.body.embeds[0].title.includes('已更新')).length, 1);
    assert.equal(events.filter(event => event.body.embeds[0].title.includes('已发布')).length, 1);
    // Visibility: public -> private removes the page, private edits stay hidden, private -> public republishes.
    const cycle = async text => {
      previous = main;
      git('switch', branch); git('merge', 'main', '--no-edit'); commit(text);
      rmSync('.native/project', { recursive: true, force: true });
      await request(); pipeline.build({ stdio: 'pipe' }); assert.equal(JSON.parse(readFileSync('.native/result.json')).ok, true, readFileSync('.native/result.json', 'utf8'));
      await pipeline.finalize();
      process.env.GITHUB_EVENT_NAME = 'push'; process.env.GITHUB_SHA = main;
      writeFileSync(eventFile, JSON.stringify({ sender: { id: 999, login: 'publishing-app[bot]' } }));
      await pipeline.prepareDeployment(); await pipeline.reportDeployment();
    };
    const hidden = text => validPost(text).replace('tags: [测试]\n', 'tags: [测试]\nvisibility: private\n');
    const titled = word => events.filter(event => event.body.embeds[0].title.includes(word));
    const page = '.native/project/dist/posts/2026-11-11-fixture/index.html';
    await cycle(hidden('转为私密。'));
    assert.ok(!existsSync(page), 'a private entry has no page');
    assert.ok(!readFileSync('.native/project/dist/feed.json', 'utf8').includes('2026-11-11-fixture'));
    assert.equal(titled('已更新').length, 2);
    assert.ok(titled('已更新')[1].body.embeds[0].description.includes('移除'));
    assert.equal(titled('私密').length, 0, 'leaving the site is reported once, as a removal');
    await cycle(hidden('私密状态下的修改。'));
    assert.equal(titled('私密').length, 1);
    assert.ok(!JSON.stringify(titled('私密')[0].body).includes('/posts/'), 'a private confirmation carries no article link');
    assert.ok(titled('私密')[0].url !== titled('已发布')[0].url, 'private confirmations use the alerts channel');
    await pipeline.reportDeployment();
    assert.equal(titled('私密').length, 1, 'private confirmations are receipt-idempotent');
    await cycle(validPost('重新公开。'));
    assert.ok(existsSync(page));
    assert.equal(titled('已发布').length, 2, 'returning to public is announced as a publication');
  } finally {
    globalThis.fetch = originalFetch; process.chdir(originalCwd);
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    if (fixture.startsWith(join(tmpdir(), 'heritage-native-flow-'))) rmSync(fixture, { recursive: true, force: true });
  }
});
