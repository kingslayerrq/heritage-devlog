# Native Git publishing

Markdown and media in this repository are the published content. Optional
[Notion authoring](NOTION_PUBLISHING.md) imports captured entries into the same
protected workflow; native Git authoring remains unchanged.
Discord is the required author identity; GitHub is optional for credited authors and
required for a person pushing a publishing branch.

The site interface stays English, and article content is English-first. Keep Chinese
author guidance in source comments. Future article translations will not localize
the site interface; see the [language policy](../README.md#language-policy).

## Author workflow

1. In Discord, use `/devlog-access register`, then `/devlog-access link-github`.
   Complete the private GitHub device sign-in, use `/devlog-access finish-link`, then `/devlog-access status`.
   Accept a repository invitation if the bot issued one. Status gives your author ID.
2. Update your local main and create an author branch. Copy
   [`templates/devlog-entry.md`](../templates/devlog-entry.md) to
   `src/content/posts/YYYY-MM-DD-short-topic.md`; see the
   [README](../README.md#file-locations) for naming rules and media locations.
   Replace the template placeholders and set `draft: false` when ready to publish.
   Select registered author IDs in `authors`; do not edit generated profile JSON.
   `npm run sync:authors` refreshes the public author snapshots for local previews.
3. Run `npm run validate` and `npm run build`, then push the branch.
4. The trusted workflow creates a PR, validates the exact revision, and automatically
   merges content that passes. The live-site link arrives in Discord after deployment.
5. To edit an existing post, update main, create a new branch and edit its Markdown.
   Keep its filename/URL and optional `entryId` stable. Edits get a separate Discord report.

Local unresolved-author warnings are verified strictly in CI using the bot's
authenticated, freshly checked registry. Public cached snapshots are never an
authorization source. Existing sample articles remain visible under their original
demo credits; new articles need real registered authors.

Content-only changes include approved Markdown and media paths. Site code,
workflows, dependencies, and generated identities are rejected for non-owner
contributors. The report lists the offending files; revert those files and retry.
The system never deletes or automatically rewrites the author's branch.
Cross-author content edits are allowed and notify both previous/current authors.

The authenticated owner account (numeric GitHub ID `22969898`) may change site
code. Commit author names/emails and candidate profile JSON do not confer ownership.

## Required setup before enabling publishing

The existing **OAuth App** used by Discord's device sign-in is separate from the
**GitHub App** used by CI. Keep the OAuth App; it proves a person's GitHub identity.
Create a repository-scoped GitHub App for the publishing automation at
https://github.com/settings/apps/new:

- Install it only on `kingslayerrq/heritage-devlog`.
- Repository permissions: **Contents: read/write**, **Pull requests: read/write**,
  **Checks: read/write**, **Actions: read/write**, **Administration: read**.
- No organization permissions or user authorization scopes are required.
- GitHub App webhook delivery is not used by this version; it may remain disabled.
- Record the numeric App ID and generate a private key. The OAuth client ID
  beginning with `Ov23...` is not a GitHub App ID.

Create a GitHub Actions environment named **`devlog-publishing`**, restricted to
the **`main` branch only**. Also restrict **`github-pages`** to **`main` only.
Use selected-branch deployment policies, not a wildcard or "all protected branches".
No manual approval is required for ordinary content publication.

Move these existing secrets from repository scope into `devlog-publishing`:

- `DISCORD_DEVLOG_ALERTS_WEBHOOK`: validation errors, warnings, policy and deployment failures.
- `DISCORD_DEVLOG_WEBHOOK`: successful first publications and article updates.

After copying them, **delete the repository-level copies**. A contributor with write
access can edit workflows on their branch; repository secrets would otherwise be
available to those workflows. Main-only environment restrictions provide the boundary.

Add to the same environment:

| Setting | Type | Purpose |
| --- | --- | --- |
| `DEVLOG_APP_PRIVATE_KEY` | Secret | Publishing GitHub App private key |
| `DEVLOG_APP_ID` | Variable | Numeric publishing App ID |
| `DEVLOG_INTEGRATION_TOKEN` | Secret | Shared token matching the bot's private environment |
| `DEVLOG_INTEGRATION_URL` | Variable | HTTPS dashboard origin, e.g. `https://dispatch.kingslayerrq.me` |

Keep `SITE_URL` and `BASE_PATH` as repository variables if customized.
Set repository variable `DEVLOG_NATIVE_ENABLED=false` during setup. Missing or
false disables the new native/deployment workflows without deleting the live site.
The bot's devlog access service and authenticated integration endpoint must be
deployed and configured before activation. Do not put its token in this repository.

Protect `main` with:

- Pull requests required; zero approving reviews for content.
- Required status check **`Devlog content`**, specifically from the publishing
  GitHub App, and **require the branch to be up to date**.
- No force pushes or deletion.
- No bypass for the publishing App; no code-owner-review requirement for content.
- The owner/admin retains their configured direct-main exception.

The finalizer checks these requirements via GitHub's branch-protection API and
fails closed if they are absent. This implementation expects classic branch
protection for that check; a ruleset-only replacement requires updating the
verification code. Initially create the check context with the App ID through the
branch-protection API if GitHub's selector has not observed its first check yet.

Before enabling publication, run **Verify native publishing setup** (`setup.yml`)
from Actions on `main` as the repository owner. It works while the feature flag is
false and sends no messages or posts. It authenticates the PEM/App ID, verifies
one active selected-repository installation limited to `heritage-devlog`, checks
required permissions, reads both webhook destinations, and calls the bot's
identity endpoint. Its logs contain only App/repository IDs, webhook IDs/names and
guild/channel IDs, plus the author count; credentials and profile data are omitted.
The action requests a short-lived installation-wide token to prove the installation
scope and revokes it when the job ends. Runtime publishing tokens remain scoped to
this repository. The default `require_integration=false` skips the bot request and
reports **skipped / publishing readiness unverified**, so App/webhook setup can be
checked before deploying the bot. Run it again with `require_integration=true`
before enabling publishing; that requires the shared token and deployed bot to
respond successfully. A skipped integration check never establishes readiness.

Set `DEVLOG_NATIVE_ENABLED=true` only after account setup, restricted environments,
App installation and protection settings are verified. The existing OAuth App
does not replace this CI setup.

## How the workflow stays trusted

`check.yml` is a secretless push notification with no checkout. Its completion
starts `native.yml` from main. A privileged prepare job runs only trusted main
code, obtains fresh verified profiles, opens/updates the PR and creates the
App-scoped required check.

The build job has no environment secrets and no persisted checkout credentials.
For ordinary authors, it exports trusted base code and overlays only validated
content/media blobs. It never executes contributor workflows, scripts, dependency
files, symlinks, or submodules. Owner-authored site-code branches may build their
code in that secretless job.

A fresh trusted finalizer verifies the PR head, reviewed main base, current member
eligibility, new coauthor eligibility, and required protection before merging the
exact head. GitHub's strict required checks close the race if main advances during
the final API call. The App merge triggers the normal main push/deploy workflow.

Main deployment retries the read-only commit-to-PR lookup within a 30-second budget because GitHub can briefly omit a just-merged association. Each candidate is checked against the full merged PR receipt, exact squash SHA, original head, repository and main branch. A missing receipt still fails closed for an automation push; no merge or publish operation is retried by this lookup. If indexing takes longer, rerun the failed deployment after GitHub exposes the receipt.

Main deployment builds the event SHA, not a mutable branch tip. Immediately before
Pages promotion, it checks that the revision is still main; replaying an older run
cannot roll the site backward. Successful reports compare against the previous
successful Pages deployment, so a previously failed deployment is included in the
next successful release.

A trusted five-minute scheduled reconciliation catches branches whose request
workflow was removed/renamed. Its scoped App token reads contents, checks and pull
requests to skip resolved work, and writes Actions to dispatch fresh checks. It uses authenticated push-run evidence or an exact
repository PushEvent head/ref. If neither exists, it rejects the unknown actor and
reports to the registered owner. Schedules can be delayed by GitHub; a manual
`Native devlog publishing` dispatch on main with the branch name is the retry path.
Schedules do not introduce an approval requirement.
Branches already contained in main (identical or behind) are skipped by both
reconciliation and manual requests, even without a previous PR. Keeping a release
branch therefore does not create empty PRs or repeated setup-error reports.

## Discord reports and recovery

Chinese embeds contain severity color/icon, title, submitting person, revision,
error/warning counts, file/line and correction guidance, plus PR/run/live links.
All automatic webhook explanations, fixes and workflow labels use Chinese.
Article titles, summaries, quoted source text, filenames, identifiers and URLs keep
their original wording; this does not translate the English-first site or content.
Known Notion diagnostics are localized at the report boundary. Unknown diagnostics
receive Chinese guidance with their diagnostic code and a link to the check log.
Mentions are explicit message-content mentions with a verified user allowlist.
Discord-only coauthors and removed credits remain report recipients. No article
text can create an everyone/role ping.

Report kinds:

- Errors and prohibited paths block merging.
- Nonblocking warnings and cross-author changes report without requiring approval.
- Publication and edit reports are emitted only after successful deployment.
- Draft-to-public transitions count as publication; media-only changes count as edits.
- Removing a public post or making it a draft produces an update stating it was removed.

The bot persists a reservation before a webhook request and the returned message
ID afterward. Keys use repository/event/article/revision rather than workflow run
number. Repeated runs and concurrent requests do not generate duplicate pings.
The webhook request uses `wait=true`; network failure, a server error or a missing
receipt is uncertain and blocks automatic resend. A confirmed unsent 4xx response
can be retried. This stores delivery metadata, not article content history.

After an uncertain delivery, inspect Discord first. The bot repository's
`scripts/devlog-report-recovery.js` can reconcile the report as sent with its
message ID, or confirmed not sent. Rerun the original workflow after reconciliation.
Do not reset a reservation merely because a request timed out.

Trusted setup/install failures use a dependency-independent fallback reporter.
If the bot/integration service itself is unavailable, no untracked webhook send is
attempted: the GitHub run remains failed and contains the recovery instruction.
This exception preserves duplicate-delivery guarantees during an integration outage.

## Validation and rollout

Run:

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run validate
npm run build
```

Tests cover policy/projection, authenticated IDs, exact-head/base protection,
new/draft/edit/media/removal detection, malformed metadata, Unicode media,
specific mentions, embed limits, duplicate runs, concurrent reservations and
uncertain delivery.

Before production activation, use a dedicated test webhook/channel and an ordinary
registered teammate. Verify account linking, a deliberate Markdown error, warnings,
forbidden code edits, corrected automatic publication, a same-post edit, cross-author
notifications, revoked eligibility, and rerun behavior. Inspect Discord messages and
the deployed page rather than relying on build success alone.

Back up the bot's devlog access/receipt state before changing its deployment.
Disabling the feature preserves identity records, delivery receipts and published
content. The owner-only **Prepare revert for review** workflow creates a draft PR;
it never updates main, merges, or deploys automatically. This optional workflow
requires the repository Actions setting that allows GitHub Actions to create pull
requests. Review its complete diff and decide whether to merge under the repository
protections. The old post-push auto-revert publisher is no longer used.

Legacy `scripts/announce.mjs`, `guard.mjs`, and `check-ownership.mjs` are retained only as historical source. No native workflow invokes them. Do not invoke them manually; `npm run announce` now uses the durable `report-deploy` path and requires a confirmed deployment context.
