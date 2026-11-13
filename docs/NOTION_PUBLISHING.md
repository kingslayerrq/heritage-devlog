# Notion publishing

Write in Notion; Discord verifies your identity and reports the result. The importer converts a captured entry into Markdown and media, then uses the same protected Git validation, build, merge and Pages deployment as native authors. GitHub is optional for Notion writers. The website interface remains English and article content is English-first.

## One-time author setup

1. Run `/devlog-access register` in Discord.
2. Run `/devlog-access link-notion`, open the private link and choose the configured team workspace. The callback completes binding automatically.
3. Check `/devlog-access status`. Names, avatars and public connections still come from Discord and optional GitHub. Notion account IDs are private.

Only an eligible registered member can submit. Every selected coauthor must also link their Notion account. The actual submitting person is verified from Notion's last editor, not the editable Authors field. Finish typing before selecting a Ready status. GitHub account binding is still required for native Git submissions.

## Write, publish and edit

Create a page in the team's **Devlog entries** database.

| Property | What to enter |
| --- | --- |
| Name | Required English article title, at most 1,000 characters |
| Discipline | Required: tech, art, design, audio, narrative or production |
| Status | Draft while writing; Ready to publish for a new post; Ready to update for an edit. Automation sets **Published (Public)** or **Published (Private)** when it finishes |
| Visibility | Optional select: **Public** or **Private**. Blank means Public |
| Authors | Optional linked people; blank credits the submitting person |
| Date | Optional date; otherwise the entry's creation date |
| Summary | Recommended short English summary |
| Tags | Recommended English topic tags |
| Published URL | Filled by automation after successful deployment; empty while the entry is private |
| Feedback | Validation and publication feedback from automation |

Write the body inside the page. Use the same useful structure as [the native template](../templates/devlog-entry.md): what changed, why, evidence and next steps. You do not need front matter, filenames, author IDs or a Git branch.

Select **Ready to publish** only when the entry is ready to become public. The importer captures the source and writes **In review** in Feedback. It leaves your Ready/Draft status unchanged while claiming so a concurrent withdrawal survives. Errors produce **Needs changes** and a Discord report; correct the page and select Ready again. Warnings are reported but do not block publication. **Published** means a successful website deployment was confirmed.

For updates, edit the same page and select **Ready to update**. The original URL stays fixed even if the title changes. Ordinary typing never updates the website. A source change during review invalidates the reviewed content; submit the new version again. A page removed from the database, archived or deleted does not automatically withdraw its published article.

### Private entries and taking an entry down

Set **Visibility** to **Private** to keep an entry off the website. It still goes through the same validation, review, merge and Discord reporting, and finishes as **Published (Private)** with an empty Published URL.

- To take a published entry down, set Visibility to **Private**, then select **Ready to update**.
- To show it again, set Visibility to **Public**, then select **Ready to update**. It returns at its original URL.
- Changing Visibility alone does nothing; like every other edit it takes effect only through a Ready status.
- Deleting, archiving or moving the Notion page still does not remove the article. Use Visibility instead.

Private does not mean secret: the converted Markdown and media are stored in the public GitHub repository and remain readable there. Do not submit confidential material.

The database owner adds the **Visibility** select (options Public, Private) and the two Status options **Published (Public)** and **Published (Private)**. A Status property of Notion's *status* type needs those options created in the Notion interface. The earlier **Published** option can remain for old pages.

GitHub polls approximately every five minutes; scheduled jobs can be delayed. The owner can run **Import Notion devlogs** manually on main. There is no Discord writing panel, export upload or second publish confirmation.

## Formatting and media

Supported content includes paragraphs, three heading levels, bold, italic, underline, strikethrough, inline code, links, lists, tasks, quotes, fenced code, dividers, callouts, simple tables, equations, bookmarks, images, supported videos, downloadable files and GLB models.

Name and Summary accept ordinary text and formatting; inline Notion mentions are rejected to prevent API truncation.

The site owns typography and layout. Notion headings become article headings beneath the article title. Colors and columns are normalized with warnings. Unsupported blocks, unsafe links and content that would be lost produce a source-linked error. Replace the indicated block rather than expecting a screenshot of the Notion page.

Upload media to Notion and provide useful English captions. Images and files are copied into the repository with content-addressed names; expiring Notion download URLs do not become public asset links. Downloads are restricted to approved HTTPS hosts, with no redirects. Notion-hosted files, Discord CDN images, Unsplash and raw GitHub media are supported; upload other media to Notion first. Links to external supported video players follow the existing site policy.

Limits are 500 blocks, 12 nesting levels, 100 block-list requests and 70 seconds per block-tree read, 256 KiB generated Markdown, 20 downloaded assets, 25 MiB per asset and 100 MiB per entry. Existing repository validation still checks paths, file types, HTML, authors and media signatures. The bot does not retain article body or image-history files; Git retains published Markdown/media history.

## Owner setup

The bot setup, database schema and private environment settings are documented in [Heritage DEVLOG.md](https://github.com/kingslayerrq/heritage-afterlife/blob/main/docs/DEVLOG.md). Use a public Notion connection with Read content, Update content and user information without emails, scoped to the team workspace.

- Homepage, if requested: `https://kingslayerrq.github.io/heritage-devlog/`
- Exact redirect: `https://dispatch.kingslayerrq.me/api/devlog-notion/callback`
- Bot private environment: `DEVLOG_NOTION_CLIENT_ID`, `DEVLOG_NOTION_CLIENT_SECRET`, `DEVLOG_NOTION_DATABASE_ID`, `DEVLOG_NOTION_ENABLED`. The database ID comes from the database link; a containing page or view ID is not a database ID.
- With database-based setup, leave `DEVLOG_NOTION_WORKSPACE_ID` and `DEVLOG_NOTION_DATA_SOURCE_ID` blank. Owner OAuth verifies the exact configured database and discovers its workspace and single data source. If the database has multiple sources, explicitly select a data-source ID. Supplied workspace/source values remain restrictions.
- The original explicit-ID setup is also supported: leave the database ID blank and provide both workspace and data-source IDs. These IDs are different; use the database settings under Manage data sources to copy the source ID.
- The owner runs `/devlog-access connect-notion` and grants the connection access to the database. Only this explicit owner installation saves an encrypted workspace credential. Ordinary linking discards its OAuth tokens. Members cannot link or publish until database setup succeeds. Changing the configured database invalidates the prior installation for that target; reconnect as owner before importing from the new destination.
- Keep the shared `DEVLOG_INTEGRATION_TOKEN` private and backed up. It also derives the workspace credential encryption key; rotation requires reconnecting Notion.
- No Notion token or OAuth secret belongs in this GitHub repository or its Actions environments. The workflow uses the existing machine integration credential to fetch a verified snapshot.

Keep repository variable `DEVLOG_NOTION_ENABLED=false` until the bot and database are configured. Native `DEVLOG_NATIVE_ENABLED=true` is still required for checks, merges and deployment. Enable Notion for the owner pilot, inspect a publication/edit and correction report, then admit teammates. The importer uses the existing publishing App and the job's read-only deployment permission; no additional App installation permission is required.

The existing protected `devlog-publishing` environment, App-scoped **Devlog content** check, main protection and secretless build remain in place. See [Native publishing](NATIVE_PUBLISHING.md) for their setup. Turning Notion off preserves source pages, Git content, public articles and recovery receipts.

## Provenance, conflicts and recovery

The bot reserves one stable filename and entry ID per source page. The initial filename uses its date, English title slug and a page-ID suffix. Each captured submission gets one deterministic `notion/<submission-id>` branch. The server binds its exact Git head, base, file hashes and verified submitter before the normal review pipeline accepts it. Imported branches cannot edit site code, author registries, workflows or unrelated media, and never impersonate a human GitHub account.

The importer compares existing managed file hashes before an update. Manual Git changes to a managed article or asset cause a conflict requiring deliberate reconciliation. It never force-pushes or overwrites a changed branch. Native Git articles continue to use their existing human GitHub authorization.

A merged Git revision and a live Pages deployment are separate states. A failed deployment does not erase the successful merge or cause another import: the importer recovers the same branch/PR, proves the merge and checks actual successful Pages deployments. An older import included unchanged in a later deployment can complete its receipt. If a newer version supersedes it before going live, only the version actually deployed is reported as published.

Discord errors, warnings, publishes and edits use existing durable delivery reservations and explicit member mention allowlists. Reports include the source link and affected people; successful reports wait for deployment. Timeouts or missing Discord receipts do not automatically resend. Use the existing report recovery procedure after inspecting Discord.

Notion status writeback retries transient failures and leaves newer human edits alone. Its API does not provide atomic compare-and-swap for page properties, so avoid changing status while a publication is completing. The final pre-merge source check protects the reviewed article content.

## Local validation

```sh
npm test
npm run lint
npm run validate
npm run build
```

Fixture tests cover conversion, downloaded media, forged provenance, source changes, stale bases, duplicate/restarted imports, managed-file conflicts, publish/edit reports and deployment recovery. They do not establish live Notion access or OAuth settings; complete the owner pilot before rollout.

