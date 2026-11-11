# Heritage devlog

The public development journal for Heritage. A static Astro site, deployed to GitHub Pages every time `main` changes.

There are two ways to publish an entry, and they can be mixed freely:

1. **By hand:** write a Markdown file in this repository and push it. Described below.
2. **From Discord:** run `/devlog` in the team server to open a block editor that writes the same files. See `docs/DEVLOG.md` in the `heritage-afterlife` bot repository. The editor cannot yet publish by itself; its "Check and export" step lists the files to add here.

Either way, the result is a Markdown file under `src/content/posts/`. Pushing it to `main` is what publishes it.

## The workflow at a glance

1. Write the entry (a Markdown file, plus any pictures) on a branch.
2. `git push`. The checker runs on your machine and stops the push if something is wrong.
3. Open a pull request. GitHub checks the entry again and checks that you only changed your own files.
4. Merge it. The site is rebuilt and published in about two minutes.
5. If a Discord webhook is set up, the new entry is announced in the channel once it is live.

You can change your own entries and profile without anyone's approval. Other people's entries are off limits, and the site's own code needs an owner's approval. Details are in [Who can change what](#who-can-change-what).

## Publish an entry by hand

1. **Get the repository and install once.**

   ```sh
   git clone https://github.com/kingslayerrq/heritage-devlog.git
   cd heritage-devlog
   npm install
   ```

   `npm install` also switches on the automatic check that runs before every push. On later visits, start with `git pull` so you have everyone else's entries.

2. **Make sure you have an author profile.** Each author is one file, `src/content/authors/<your-id>.json`. The file name (lowercase letters, digits and dashes, starting with a letter) is the id you sign entries with. Only `name` is required:

   ```json
   {
     "name": "Display name",
     "role": "Gameplay programmer",
     "discipline": "tech",
     "bio": "One or two sentences.",
     "avatar": "/media/authors/your-id.png",
     "discord": "123456789012345678",
     "github": "your-github-user-name",
     "links": [{ "label": "GitHub", "url": "https://github.com/you" }]
   }
   ```

   `github` is what makes the profile yours: only that GitHub account (and the repository owners) can change the profile or the entries signed with it. Set it when you create the profile; it is not shown on the site. `discord` is your Discord user id. It adds a public link to your Discord profile, so leave it out unless you want strangers to be able to message you. Put the avatar picture at `public/media/authors/your-id.png`; without one, the site shows your initial.

3. **Create the entry.** Add `src/content/posts/YYYY-MM-DD-short-title.md`. The file name becomes the address: `/posts/YYYY-MM-DD-short-title/`.

   ```yaml
   ---
   title: Opening the door
   date: 2026-11-10
   discipline: tech     # exactly one of: tech, art, design, audio, narrative, production
   authors: [your-id]   # author ids, lead author first; co-authors after
   summary: One or two sentences shown on the front page and in Discord.
   tags: [Puzzles, Front hall]
   cover: /media/2026-11-10-short-title/cover.jpg
   coverAlt: What the cover shows
   draft: false         # true keeps the entry off the site
   ---

   The entry itself, in Markdown.
   ```

   `title`, `date` and `discipline` are required. An `authors` id with no matching profile file stops the build, so a byline is never silently lost.

4. **Add pictures and clips.** Put them in `public/media/<entry-file-name>/` and refer to them as `/media/<entry-file-name>/file.png`. Keep clips short (the whole site is limited to 1 GB); longer videos go on YouTube and are embedded.

5. **Check it locally.**

   ```sh
   npm run dev
   ```

   Open the address it prints (it ends in `/heritage-devlog/`). To check the entry at any time:

   ```sh
   npm run validate
   ```

   It names the file and line of anything wrong. See [What the checker looks for](#what-the-checker-looks-for). You do not have to remember to run it: it runs by itself whenever you push.

6. **Publish through a pull request.** `main` is protected: nobody but the repository owners can push to it directly.

   ```sh
   git switch -c short-title
   git add .
   git commit -m "Add entry: short title"
   git push -u origin short-title
   ```

   The checker runs first, on your machine. If it finds an error the push is stopped and nothing leaves your computer: fix it, commit, push again.

   Open the link git prints and create the pull request. The **Check entries** run then checks the entry again and checks that every file you changed is yours (see [Who can change what](#who-can-change-what)). When it is green, press **Merge**. You do not need anyone's approval for your own entries.

   Merging starts the **Build and deploy** workflow (Actions tab), which publishes the site, usually within two minutes. If a Discord webhook is configured, the entry is announced there once the site is live. If the build fails, nothing is published and the previous version of the site stays up.

   If you do not have write access to this repository, fork it on GitHub, push to your fork, and open the pull request from there; an owner will merge it.

To change or remove one of your entries, edit or delete its file and open another pull request. Announcements are only sent for newly added entries.

## Who can change what

| Files | Who can change them |
| --- | --- |
| An author profile, `src/content/authors/<id>.json`, and its picture | The GitHub account in its `github` field |
| An entry, `src/content/posts/…md`, and its folder under `public/media/` | The authors listed in the entry |
| Everything else: layouts, styles, scripts, workflows, config, sample media | The repository owners, or anyone with an owner's approval on the pull request |
| Anything at all | The repository owners (listed in `.github/CODEOWNERS`) |

How this is enforced:

- **`main` is protected.** Changes arrive only through pull requests whose **Check entries** run has passed. Owners are exempt and can push directly.
- **Ownership of entries** is checked by `scripts/check-ownership.mjs` in that run. It looks at who opened the pull request, and at each entry's authors as they were before the change, so adding yourself to someone else's entry does not let you edit it. To add a co-author, or to hand an entry over, ask one of its authors or an owner.
- **The site's own code** is covered by `.github/CODEOWNERS`: GitHub will not let a pull request that touches it be merged until an owner has approved.

Entries with no `authors`, and profiles with no `github`, belong to the owners.

## Where the checks run

| When | What is checked | On an error |
| --- | --- | --- |
| `git push` from your machine (set up by `npm install`) | Entries are valid | The push is stopped |
| A pull request, or a push to a branch | Entries are valid; the changed files are yours; the site builds | The pull request cannot be merged |
| A change landing on `main` | Entries are valid; the site builds | The site is not rebuilt; the previous version stays up |

The first is a convenience and can be skipped with `git push --no-verify`. The other two cannot.

## What an entry can contain

Ordinary Markdown, plus a few blocks written as small tags. The sample entry "Everything a page can hold" (`src/content/posts/2026-11-11-everything-a-page-can-hold.md`) shows each one and is the best thing to copy from.

| Block | How to write it |
| --- | --- |
| Gallery | `<hx-gallery caption="…">` around several Markdown images |
| Before / after | `<hx-compare before="/media/…" after="/media/…" before-label="Blockout" after-label="Lit"></hx-compare>` |
| Video | `<hx-video src="/media/…/clip.mp4" caption="…"></hx-video>` or `<hx-video youtube="VIDEO_ID"></hx-video>` |
| 3D model | `<hx-model src="/media/…/model.glb" alt="…"></hx-model>` |
| Diagram | a code fence marked `mermaid` |
| Formula | `$inline$` or a `$$` block, in TeX |
| Blueprint | `<hx-blueprint src="https://blueprintue.com/render/ID/"></hx-blueprint>` |
| Build note | `<hx-build version="0.3.1" changelist="1482" date="2026-11-10">` around a list |
| Note | `<hx-note>` or `<hx-note kind="clue">` around text |

When a block wraps Markdown (gallery, build note, note), leave a blank line after the opening tag and before the closing tag.

## What the checker looks for

`npm run validate` (or `npm run validate -- src/content/posts/your-file.md` for one entry) reads every entry and author profile. Errors stop publication; warnings do not.

| Errors | Warnings |
| --- | --- |
| File not named `YYYY-MM-DD-short-title.md` | Date differs from the date in the file name |
| Front matter missing or not valid YAML | No `authors` (signed "The Heritage team") |
| Missing `title`, `date` or `discipline`; a `discipline` not on the list | No `summary`, or one over 300 characters |
| A misspelt or unknown field | Cover without `coverAlt` |
| An author id with no profile file | SVG cover (Discord cannot show it) |
| `visibility: internal` (this repository is public) | Entry marked `draft: true` |
| A picture, clip, cover or avatar that is not in `public/` | Media approaching the 1 GB site limit |
| An unknown, unclosed or incomplete `hx-` block; a code block never closed | |
| A media file over 25 MB | |
| An author profile with unknown fields, no `name`, or bad links | |

## Discord announcements

After a push to `main` has been deployed, the workflow posts one message per newly added public entry to a Discord channel, through a channel webhook. Edits and deletions are not announced, and neither are drafts.

To switch it on:

1. In Discord, open the channel's **Edit Channel → Integrations → Webhooks → New Webhook**. Give it the name and picture the announcements should appear under, and copy its URL.
2. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `DISCORD_DEVLOG_WEBHOOK` and paste the URL.

The URL is a password for posting to that channel: keep it only in that secret, never in a file. Use a repository secret, not an environment secret; the announce job does not run in an environment, so it could not read one. Without the secret the announce step does nothing and still passes.

## One-time repository setup

1. Push this folder to the `main` branch of a GitHub repository named `heritage-devlog`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Optional: add a repository secret `DISCORD_DEVLOG_WEBHOOK` holding a Discord channel webhook URL, to announce each new public entry.
4. Optional: if the repository has a different name or uses a custom domain, set the repository variables `BASE_PATH` (for example `/other-name`, or `/` for a custom domain) and `SITE_URL`.
5. Optional: set `discordInvite` in `src/lib/site.ts` to the server's invite link, shown as the contact link for authors with none of their own.

## For automation

- `/feed.json` lists every public entry with its raw Markdown, discipline and authors.
- `/rss.xml` is a standard RSS feed.
- `scripts/announce.mjs` posts new entries to Discord from the deploy workflow.
