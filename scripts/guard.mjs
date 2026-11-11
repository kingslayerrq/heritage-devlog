// Runs after every push to main, before the site is built.
//   - Site code pushed by someone who is not an owner, without an owner-approved pull request,
//     is undone (git revert) so it is never published.
//   - Changes to other people's entries are allowed, and reported to Discord.
//   - People credited as co-authors are told.
// Environment: ACTOR, BASE, GITHUB_REPOSITORY, GITHUB_TOKEN, and optionally
// DISCORD_DEVLOG_ALERTS_WEBHOOK, DEVLOG_PEOPLE (JSON: [{ github, discord, author }]), DRY_RUN=1.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { report, profileOwner } from './check-ownership.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const { ACTOR: actor, BASE: base, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token, DISCORD_DEVLOG_ALERTS_WEBHOOK: webhook } = process.env;
const dryRun = process.env.DRY_RUN === '1';
const site = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}`;
const output = (key, value) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`); };

if (!actor || !base || /^0+$/.test(base)) { console.log('Nothing to compare this push against; skipping the guard.'); output('reverted', 'false'); process.exit(0); }
const result = report({ actor, base });
if (result.isOwner) { console.log(`${result.actor} is a repository owner: nothing to guard.`); output('reverted', 'false'); process.exit(0); }

// --- Who is who in Discord -----------------------------------------------------
let people = [];
try { people = JSON.parse(process.env.DEVLOG_PEOPLE || '[]').filter(person => /^\d{15,22}$/.test(String(person?.discord || ''))); }
catch { console.log('DEVLOG_PEOPLE is not valid JSON; people will be named without mentions.'); }
const mentioned = new Set();
const mention = (discord, fallback) => { if (!discord) return fallback; mentioned.add(String(discord)); return `<@${discord}>`; };
const byGithub = login => mention(people.find(person => String(person.github || '').toLowerCase() === login.toLowerCase())?.discord, `**${login}**`);
const byAuthor = id => mention((people.find(person => person.author === id) || people.find(person => String(person.github || '').toLowerCase() === profileOwner('HEAD', id) && person.github))?.discord, `**${id}**`);
const ownersText = () => result.owners.map(byGithub).join(', ');
const list = paths => { const shown = [...new Set(paths)]; return shown.slice(0, 8).map(path => `• \`${path}\``).join('\n') + (shown.length > 8 ? `\n• and ${shown.length - 8} more` : ''); };

// --- Site code: was it approved by an owner in a pull request? -------------------
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
  return response.json();
}
async function ownerApproved(sha) {
  if (!token || !repo) return false;
  try {
    for (const pull of (await api(`/commits/${sha}/pulls`)).filter(candidate => candidate.merged_at && candidate.base?.ref === 'main')) {
      const latest = new Map();
      for (const review of await api(`/pulls/${pull.number}/reviews?per_page=100`)) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user.login.toLowerCase(), review.state);
      if (result.owners.some(owner => latest.get(owner) === 'APPROVED')) return true;
    }
  } catch (error) { console.log(`Could not look up approvals for ${sha.slice(0, 7)} (${error.message}); treating it as not approved.`); }
  return false;
}

const unapproved = [];
for (const commit of result.commits) if (commit.siteCode.length && !(await ownerApproved(commit.sha))) unapproved.push(commit);

let reverted = [], failed = [];
if (unapproved.length && !dryRun) {
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  for (const commit of [...unapproved].reverse()) {
    try { git('revert', '--no-edit', ...(commit.merge ? ['-m', '1'] : []), commit.sha); reverted.push(commit); }
    catch { try { git('revert', '--abort'); } catch { /* nothing in progress */ } failed.push(commit); }
  }
  if (reverted.length) {
    try { git('push', 'origin', 'HEAD:main'); }
    catch {
      // Either main moved meanwhile (retry once), or the change touched workflow files, which the
      // workflow's own token is not allowed to rewrite. Then an owner has to step in.
      try { git('pull', '--rebase', 'origin', 'main'); git('push', 'origin', 'HEAD:main'); }
      catch { failed.push(...reverted); reverted = []; }
    }
  }
} else if (dryRun) reverted = unapproved;
output('reverted', String(reverted.length > 0 && !dryRun));
output('blocked', String(failed.length > 0));

// --- Tell people ---------------------------------------------------------------
const messages = [];
const pusher = byGithub(result.actor);
const link = commit => `[\`${commit.sha.slice(0, 7)}\`](${site}/commit/${commit.sha})`;
if (reverted.length) messages.push(`**Site code change undone**\n${pusher} pushed a change to the site's own code straight to \`main\`:\n${list(reverted.flatMap(commit => commit.siteCode))}\nIt was undone automatically and was never published (${reverted.map(link).join(', ')}). To make this change, open a pull request; ${ownersText()} needs to approve it.`);
if (failed.length) messages.push(`**Site code change needs attention**\n${ownersText()}: ${pusher} pushed a change to the site's own code (${failed.map(link).join(', ')}) that could not be undone automatically. The site has **not** been rebuilt. Undo or approve it by hand:\n${list(failed.flatMap(commit => commit.siteCode))}`);
for (const commit of result.commits.filter(candidate => candidate.foreign.length)) {
  const authors = [...new Set(commit.foreign.flatMap(item => item.authors))];
  messages.push(`**Someone else's work was changed**\n${pusher} changed files belonging to ${authors.length ? authors.map(byAuthor).join(', ') : 'the repository owners'}:\n${commit.foreign.slice(0, 8).map(item => `• \`${item.path}\` (${item.change})`).join('\n')}\nThe change is live. [See what changed](${site}/commit/${commit.sha}). If it should not stand, ${ownersText()} can undo it: run [Undo a change](${site}/actions/workflows/revert.yml) with \`${commit.sha.slice(0, 10)}\`.`);
}
for (const item of result.commits.flatMap(commit => commit.credited.map(credit => ({ ...credit, sha: commit.sha })))) {
  messages.push(`${item.authors.map(byAuthor).join(', ')}: ${pusher} credited you as co-author of **${item.title}**. [See the entry file](${site}/blob/${item.sha}/${item.path}).`);
}

if (!messages.length) console.log('Nothing to report for this push.');
for (const text of messages) {
  const content = `${dryRun ? '*(test run, nothing was changed)*\n' : ''}${text}`.slice(0, 1990);
  console.log(`\n${content.replace(/<@\d+>/g, '<@…>')}`);
  if (!webhook) continue;
  const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [], users: [...mentioned].filter(id => content.includes(`<@${id}>`)).slice(0, 100) }, flags: 4 }) });
  if (!response.ok) console.log(`Discord rejected the alert: ${response.status}`);
}
if (messages.length && !webhook) console.log('\nDISCORD_DEVLOG_ALERTS_WEBHOOK is not set, so these were not sent to Discord.');
if (failed.length) process.exit(1);
