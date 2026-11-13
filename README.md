# Heritage devlog

The public development journal for Heritage. Authors register through Discord and submit Markdown through Git branches. Valid submissions are automatically merged and deployed to GitHub Pages. Native Git publication and editing remain available. Optional [Notion authoring](docs/NOTION_PUBLISHING.md) uses the same validation and deployment workflow; it stays disabled until the owner completes connection setup and a live pilot.

## Language policy

The **website interface always stays in English**: navigation, buttons, labels, accessibility text, and system messages on the site. Devlogs are **English-first**: write the title, summary, body, tags, captions, and image descriptions in English. Platform display names and quoted source material can retain their original spelling.

Article translations may be added later as alternate versions of the content; they will not change the language of the site interface. Translation fields and routing are not implemented yet. Chinese author guidance belongs in YAML comments (`# ...`) or HTML comments (`<!-- ... -->`), not in the published article text. Comments are hidden from the rendered article, but remain readable in this public repository.

## One-time author setup

1. Run `/devlog-access guide` in the team's Discord server and open the bot's DM. Pressing a route button registers you; the website will publicly display your Discord name, avatar, and profile link.
2. If you will push Git branches, press **用 GitHub 投稿** in that DM and complete the private GitHub authorization; the DM updates by itself. Accept a repository invitation if one is issued.
3. Run `/devlog-access status` to obtain your stable author ID. Every credited author needs Discord registration; GitHub is optional for coauthors who do not push branches.
4. Install Node.js 22 or later, clone this repository, and run `npm ci`.

Names, avatars, and platform links come from the verified account registry. Do not create author JSON files, upload profile avatars, or use a GitHub username as an author ID. Renaming a platform account does not change its author ID.

For Notion, press **用 Notion 投稿** in the same DM, then write in the team database. GitHub and a local clone are optional for that route. See [Notion publishing](docs/NOTION_PUBLISHING.md).

## Write and publish

Start from the repository root:

```sh
git switch main
git pull --ff-only
git switch -c devlog/your-topic
npm run sync:authors
```

`sync:authors` retrieves public display information for local previews. Generated profiles are ignored by Git. If the service is unavailable, you can still check content offline; missing local profiles produce a warning. GitHub verifies authors against the authenticated, current registry before publication.

### File locations

| Purpose | Repository location | Notes |
| --- | --- | --- |
| Reusable template | [`templates/devlog-entry.md`](templates/devlog-entry.md) | Copy it for each new article. Keep the shared template in place; it is not published. |
| Article | `src/content/posts/YYYY-MM-DD-short-topic.md` | One UTF-8 `.md` file containing YAML metadata and Markdown body text. |
| Images, videos, and attachments | `public/media/YYYY-MM-DD-short-topic/` | Use a folder matching the article's filename without `.md`. |
| Author profiles | `src/content/authors/` | Generated automatically; do not edit or commit these files. |

Example:

```text
templates/devlog-entry.md                              shared reference
src/content/posts/2026-11-11-first-playtest.md           your article
public/media/2026-11-11-first-playtest/cover.png         optional cover
public/media/2026-11-11-first-playtest/door-feedback.png optional body image
```

### Filenames and public URLs

- Use `YYYY-MM-DD-short-topic.md`, for example `2026-11-11-first-playtest.md`. Prefer a short, lowercase English topic.
- The validator accepts letters and numbers separated by single hyphens. Spaces, underscores, repeated hyphens, and extra dots are invalid. Use lowercase `.md` as the extension. Existing Unicode filenames remain supported; do not rename published articles just to translate their paths.
- For a new article, keep the filename date and metadata `date` consistent. Multiple articles on the same day need different topic names.
- **The complete filename determines the public URL.** This example becomes `https://kingslayerrq.github.io/heritage-devlog/posts/2026-11-11-first-playtest/`.
- Keep the filename unchanged when editing an existing article, even if its title changes. Do not create a dated copy for an ordinary update.

### Copy the template

Copy [`templates/devlog-entry.md`](templates/devlog-entry.md) into the article directory. Replace the example date and topic in these commands; the destination file should not already exist.

Windows PowerShell:

```powershell
Copy-Item templates/devlog-entry.md src/content/posts/2026-11-11-first-playtest.md
```

macOS, Linux, or Git Bash:

```sh
cp -n templates/devlog-entry.md src/content/posts/2026-11-11-first-playtest.md
```

Open the copy in a text editor. On GitHub, use **Code** or **Raw** to see the full template: its Chinese help, checklist, and optional formatting/media reference are comments, so they do not appear in the rendered article. Copy only the examples you need out of the reference comment, then replace their text and paths.

### What must be included

| Item | Requirement | What to enter |
| --- | --- | --- |
| `title` | Required | An English article title. Quotes help when the title contains a colon. |
| `date` | Required | A real date in `YYYY-MM-DD` format. Replace the example date. |
| `discipline` | Required | One of `tech`, `art`, `design`, `audio`, `narrative`, or `production`. |
| `authors` | Required | 1–20 registered author IDs. Replace `your-author-id` with the output of `/devlog-access status`; the first author is primary. Do not use usernames or demo author IDs. |
| Body text | Required | Nonempty English Markdown below the closing `---`. Replace the template's example paragraphs with your work. |
| `summary` | Recommended | A short English summary. Omitting it produces a warning; an explicitly empty value is invalid. |
| `tags` | Recommended | Short English topic labels, e.g. `[Playtesting, Interaction]`. Use `[]` if none apply. |
| `cover` and `coverAlt` | Optional | A real image path and an English image description. Leave the template's lines commented out if there is no cover. PNG/JPEG/WebP covers work in Discord previews; SVG covers do not. |
| `visibility` | Optional | `public` (default) or `private`. A private entry passes every check and is merged, but has no page on the website. See [Private entries](#private-entries-and-taking-an-entry-down). |
| `draft` | Publication control | The template uses `true`. Change it to `false` when ready for the article to appear on the site. |

The body headings are suggestions, not mandatory sections. A useful entry explains what changed, why, what was tested or learned, and what comes next.

Optional `entryId` is reserved for stable source tracking. Ordinary Git articles do not need it. If supplied, it must be unique, 8–64 characters, start with a letter or number, and contain only letters, numbers, `_`, or `-`. Keep it unchanged across edits. Do not add unsupported metadata fields such as `language` or `translationOf` yet.

### Text styles and fonts

Markdown controls structure and emphasis; the site theme controls the fonts, sizes, and colors. Article headings use the site's display serif, body text uses its reading serif, and code uses monospace. Authors cannot select arbitrary font families or use inline CSS. The template contains copyable examples of:

| Style | Syntax |
| --- | --- |
| Section / subsection / detail heading | `## Heading`, `### Heading`, `#### Heading` |
| Bold / italic / both | `**bold**`, `*italic*`, `***bold italic***` |
| Strikethrough / underline | `~~old approach~~`, `<u>underlined text</u>` |
| Inline code | `` `DoorState.Open` `` |
| Subscript / superscript | `H<sub>2</sub>O`, `x<sup>2</sup>` |
| Quote | `> A playtester could not see the indicator.` |
| Bullets / numbered lists | `- First item`, `1. First step` |
| Task list | `- [ ] Follow-up`, `- [x] Completed` |
| Link | `[Link text](https://example.com)` |

The page already renders `title` as its main heading. Start body sections with `##`. The template also demonstrates tables, fenced code with syntax highlighting, Mermaid diagrams, and math.

### Media and richer blocks

Place media in `public/media/<article-folder>/` and reference it as `/media/<article-folder>/filename`. Match filename case exactly. Do not include `public/`, a local disk path, or the deployment prefix `/heritage-devlog` in an article link; the site adds its base path.

```markdown
![A green indicator above the unlocked door](/media/2026-11-11-first-playtest/door-feedback.png)
```

Use English captions and descriptive alt text. Add the actual files before enabling optional media examples. Images are not required for a text-only article.

| Content | Supported syntax |
| --- | --- |
| Image or animated GIF | `![Description](/media/my-entry/image.png)` or a `.gif` path |
| Gallery | `<hx-gallery caption="...">` around Markdown images |
| Before/after comparison | `<hx-compare before="/media/..." after="/media/..." before-label="Before" after-label="After"></hx-compare>` |
| MP4/WebM video | `<hx-video src="/media/my-entry/clip.mp4" caption="..."></hx-video>` |
| YouTube video | `<hx-video youtube="VIDEO_ID" caption="..."></hx-video>` |
| Self-contained 3D model | `<hx-model src="/media/my-entry/model.glb" alt="..."></hx-model>` |
| Downloadable file | `[Download the notes (PDF)](/media/my-entry/notes.pdf)` |
| Unreal Blueprint | `<hx-blueprint src="https://blueprintue.com/render/YOUR_ID/"></hx-blueprint>` |
| Build notes | `<hx-build version="0.3.1" changelist="1482" date="2026-11-11">` around a list |
| Note or clue | `<hx-note>` or `<hx-note kind="clue">` around text |

Leave blank lines inside gallery, build, and note wrappers. Close every `hx-*` tag. The [template](templates/devlog-entry.md) includes complete examples; the [sample reference article](src/content/posts/2026-11-11-everything-a-page-can-hold.md) shows richer blocks in context. Do not copy its demo author credits.

Supported uploads: PNG, JPEG, WebP, GIF, AVIF, static SVG, MP4, WebM, self-contained GLB, PDF, ZIP, and TXT. Each file is limited to **25 MiB**; article files are limited to **256 KiB**. File bytes must match the extension. GLB textures and buffers must be embedded. Standalone audio embeds are not currently supported.

HTML uses an allowlist: scripts, event handlers, inline styles, arbitrary iframes, and dynamic components are rejected. Use the supported Markdown and `hx-*` blocks. Media URLs cannot use `javascript:`, `data:`, path traversal, or protocol-relative URLs. Blueprint embeds must use an approved HTTPS BlueprintUE render URL.

### Check, preview, and publish

Replace the author ID, date, text, and any media paths. Set `draft: false` to preview the article page or publish it: drafts are hidden from local article routes as well as the live site.

```sh
npm run validate
npm run build
npm run dev
```

Inspect the local site, then stop the development server with Ctrl+C. Commit the article and, if present, its media:

```sh
git add src/content/posts/2026-11-11-first-playtest.md
# Skip this line if the article has no media files.
git add public/media/2026-11-11-first-playtest
git commit -m "Add devlog: first playtest"
git push -u origin devlog/your-topic
```

The installed pre-push check catches local content errors. GitHub creates or updates a PR, validates content and identity, builds, then automatically merges and deploys valid work. Discord receives the result. Warnings do not block otherwise valid content; fix errors and push again to the same branch.

For an edit, update `main`, create a new branch, and modify the original article/media. Keep the filename and URL stable. A successful deployment produces an edit report. Moving a draft to public produces a first-publication report; rerunning the same report does not send duplicate notifications.

**This repository is public.** `draft: true` hides an article from the site, not its source from GitHub. Comments are public too. Do not commit private material, credentials, or `internal` articles.

## Private entries and taking an entry down

Add `visibility: private` to an entry's metadata to keep it off the website. A private entry is validated, reviewed, merged and reported exactly like a public one, but it has no article page and does not appear on the home page, author, tag or discipline pages, or in the RSS and JSON feeds. Media used only by private or draft entries is left out of the deployed site.

- **Take a published entry down:** change it to `visibility: private` on a new branch and push. After deployment the page and its media are gone, and Discord receives an update saying it was removed.
- **Bring it back:** remove the line or set `visibility: public` and push. The entry returns at the same URL and is announced as a publication.
- **Publish privately from the start:** set `draft: false` and `visibility: private`. Discord receives a private confirmation in the alerts channel with no article link.

**Private does not mean secret.** This repository is public, so the Markdown, media and full history of a private entry stay readable on GitHub. The validator reminds you of this with a warning. Never commit confidential material; `internal` and other values are rejected. Search engines and other sites may also keep copies of a page that was public before it was taken down.

## What contributors may change

| Change | Policy |
| --- | --- |
| Article Markdown and approved media | Automatically merged after checks pass |
| Another author's article or credits | Collaborative edits allowed; the submitter and affected previous/current authors are notified |
| Generated author profiles or identity bindings | Managed only through the trusted registry |
| Site code, styles, scripts, configuration, workflows, dependencies | Rejected for ordinary author submissions; remove those changes before retrying |
| Site-code changes from the verified repository owner | Allowed, with validation and deployment checks |

Commit author names, article credits, and candidate author JSON cannot establish the submitter's identity. The verified numeric GitHub account binding does that.

The two existing demo articles retain their demo credits only while their approved content matches exactly. New articles and ordinary edits to demo articles require real registered authors; do not reuse demo credits in your template copy.

## Discord reports

- `DISCORD_DEVLOG_ALERTS_WEBHOOK`: errors, warnings, cross-author edits, policy violations, and build/deployment failures.
- `DISCORD_DEVLOG_WEBHOOK`: first publications and updates after a successful site deployment.

Operational Discord reports currently use Chinese, with severity colors, affected files, correction guidance, and relevant links. They mention only verified related members. This does not change the English-language website policy. A successful build alone is not a confirmed publication. Durable delivery receipts prevent automatic resends after uncertain webhook outcomes.

Keep both webhooks in the protected, main-only `devlog-publishing` GitHub Environment. Never put credentials in repository files, contributor branches, or public profiles. See [native publishing setup](docs/NATIVE_PUBLISHING.md) for App permissions, branch protection, environment settings, and recovery.

## Development and verification

Engineering skill configuration is indexed in [AGENTS.md](AGENTS.md). Edit `docs/agents/*.md` to update tracker, triage, or domain documentation conventions.

```sh
npm ci
npm test
npm run lint
npm run validate
npm run build
```

Tests cover identity mapping, content safety, Git policy, and notification recovery. Lint checks JavaScript syntax, conflict markers, and trailing whitespace without an extra dependency. Astro's build checks templates and TypeScript compilation. `npm run validate -- --json` prints structured diagnostics; append an article path to limit content validation.

Direct dependencies are pinned. The validator explicitly uses unified 11.0.5, remark-parse 11.0.0, and parse5 8.1.1, already present in the Astro dependency tree, to parse Markdown/HTML instead of guessing from regular expressions.

Local author sync defaults to `https://dispatch.kingslayerrq.me/api/devlog-authors`. Override it with `DEVLOG_PUBLIC_API_URL` or the command argument. Only local tests may use `--allow-local-test` with loopback HTTP. Responses are limited to 1 MiB and 1,000 people; requests send no credentials and follow no redirects. This public cache is for display, not publication authorization.

The Astro configuration uses `passthroughImageService` to serve uploaded images unchanged, without Sharp decoding/optimization. Remote optimizer allowlists are empty, and article images cannot import relative source files. The pinned Astro 5.18.2 dependency tree still has previously reported audit findings; disabling this image-processing path is not a full dependency upgrade. Review framework upgrades separately; do not run `npm audit fix --force` automatically.

Notion and Google Docs imports and article translations are future work. There is no separate web or Discord writing editor in the native Git workflow.
