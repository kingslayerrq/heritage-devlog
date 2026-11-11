# Heritage devlog

The public development journal for Heritage. A static Astro site, deployed to GitHub Pages every time `main` changes.

There are two ways to publish an entry, and they can be mixed freely:

1. **By hand:** write a Markdown file in this repository and push it. Described below.
2. **From Discord:** run `/devlog` in the team server to open a block editor that writes the same files. See `docs/DEVLOG.md` in the `heritage-afterlife` bot repository. The editor cannot yet publish by itself; its "Check and export" step lists the files to add here.

Either way, the result is a Markdown file under `src/content/posts/`. Pushing it to `main` is what publishes it.

## Publish an entry by hand

1. **Get the repository and install once.**

   ```sh
   git clone https://github.com/kingslayerrq/heritage-devlog.git
   cd heritage-devlog
   npm install
   ```

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

   Open the address it prints (it ends in `/heritage-devlog/`). Run `npm run build` before pushing if you want to be sure the entry builds.

6. **Publish.**

   ```sh
   git add .
   git commit -m "Add entry: short title"
   git push
   ```

   The **Build and deploy** workflow (Actions tab) builds the site and publishes it, usually within two minutes. If a Discord webhook is configured, the entry is announced there once the site is live. If the build fails, the previous version of the site stays up; open the failed run to see which file and field was wrong.

To change or remove an entry, edit or delete its file and push again. Announcements are only sent for newly added entries.

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
