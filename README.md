# Heritage devlog

The public development journal for Heritage. A static Astro site, deployed to GitHub Pages every time `main` changes.

There are two ways to publish an entry, and they can be mixed freely:

1. **By hand:** write a Markdown file in this repository and push it. Described below.
2. **From Discord:** run `/devlog` in the team server to open a block editor that writes the same files. See `docs/DEVLOG.md` in the `heritage-afterlife` bot repository. The editor cannot yet publish by itself; its "Check and export" step lists the files to add here.

Either way, the result is a Markdown file under `src/content/posts/`. Pushing it to `main` is what publishes it.

## The workflow at a glance

1. Write the entry (a Markdown file, plus any pictures).
2. `git push`. The checker runs on your machine and stops the push if something is wrong.
3. GitHub runs the same check, builds the site and publishes it, in about two minutes.
4. If a Discord webhook is set up, the new entry is announced in the channel once it is live.

Entries go straight to `main`. Changes to the site itself go through a pull request. Details are in [Branches and pull requests](#branches-and-pull-requests).

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
     "links": [{ "label": "GitHub", "url": "https://github.com/you" }]
   }
   ```

   `discord` is your Discord user id. It adds a public link to your Discord profile, so leave it out unless you want strangers to be able to message you. Put the avatar picture at `public/media/authors/your-id.png`; without one, the site shows your initial.

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

6. **Publish.**

   ```sh
   git add .
   git commit -m "Add entry: short title"
   git push
   ```

   The checker runs first, on your machine. If it finds an error the push is stopped and nothing leaves your computer: fix it, commit, push again.

   If git refuses the push because someone else published in the meantime, run `git pull --rebase` and push again.

   Once the push goes through, the **Build and deploy** workflow (Actions tab) runs the same checker, builds the site and publishes it, usually within two minutes. If a Discord webhook is configured, the entry is announced there once the site is live. If the check or the build fails, nothing is published and the previous version of the site stays up; open the failed run to see which file and line was wrong.

To change or remove an entry, edit or delete its file and push again. Announcements are only sent for newly added entries.

## Where the check runs

| When | What happens on an error |
| --- | --- |
| `git push` from your machine (set up by `npm install`) | The push is stopped |
| A push to `main` by any route, including edits made on github.com | The site is not rebuilt; the previous version stays up |
| A pull request, or a push to another branch | The **Check entries** run fails and marks the problems on the files |

The first is a convenience and can be skipped (`git push --no-verify`, or editing on github.com). The second cannot, and is what protects the live site.

## Branches and pull requests

- **Entries** (a Markdown file, its media, your author profile): push straight to `main`. The checks above are the review.
- **Changes to the site itself** (anything under `src/` other than `content/`, plus `scripts/`, `.github/` and the config files): make a branch and open a pull request, so someone else looks before it affects every page.
- **An entry you want a second opinion on**: a pull request works for that too. Mark the entry `draft: true` if it should be merged before it is ready to show.

This is the team's convention; GitHub does not enforce it. To open a pull request:

```sh
git switch -c short-description
git add .
git commit -m "What changed"
git push -u origin short-description
```

Then open the link git prints, create the pull request, and wait for **Check entries** to pass before merging. Merging into `main` publishes the change.

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
