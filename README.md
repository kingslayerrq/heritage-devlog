# Heritage devlog

The public development journal for Heritage. A static Astro site, deployed to GitHub Pages every time `main` changes.

There are two ways to publish an entry, and they can be mixed freely:

1. **By hand:** write a Markdown file in this repository and push it. Described below.
2. **From Discord:** run `/devlog` in the team server to open a block editor that writes the same files. See `docs/DEVLOG.md` in the `heritage-afterlife` bot repository. The editor cannot yet publish by itself; its "Check and export" step lists the files to add here.

Either way, the result is a Markdown file under `src/content/posts/`. Pushing it to `main` is what publishes it.

## The workflow at a glance

1. Write the entry (a Markdown file, plus any pictures).
2. `git push` to `main`. The checker runs on your machine and stops the push if something is wrong.
3. GitHub checks it again, builds the site and publishes it, in about two minutes.
4. The new entry is announced in Discord once it is live.

New entries are always welcome, and you can credit teammates as co-authors. Changing someone else's entry is allowed but they are told in Discord, and an owner can undo it. Changes to the site's own code need an owner's approval. Details are in [Who can change what](#who-can-change-what).

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

   `github` is what makes the profile yours: changes to the profile, or to entries signed with it, by anyone else are reported to you in Discord. Set it when you create the profile; it is not shown on the site. `discord` is your Discord user id. It adds a public link to your Discord profile, so leave it out unless you want strangers to be able to message you. Put the avatar picture at `public/media/authors/your-id.png`; without one, the site shows your initial.

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

   Once the push goes through, the **Build and deploy** workflow (Actions tab) checks the entry again, builds the site and publishes it, usually within two minutes. The entry is then announced in Discord. If the check or the build fails, nothing is published and the previous version of the site stays up; open the failed run to see which file and line was wrong.

   You need write access to push. Team members get an invitation when they link their GitHub account through the `/devlog` command in Discord. Without access, fork the repository and open a pull request.

To change or remove one of your entries, edit or delete its file and push again. Announcements are only sent for newly added entries.

## Who can change what

| What you do | What happens |
| --- | --- |
| Add a new entry, profile or media file | Always accepted. Co-authors you credit are told in Discord. |
| Change your own entry, its media, or your profile | Accepted. |
| Change or delete someone else's entry, media or profile | Accepted and published, but the owners of those files, you and the repository owners are mentioned in a Discord alert. An owner can undo it. |
| Change the site's own code: layouts, styles, scripts, workflows, config | Pushed straight to `main`, it is undone automatically within a minute or so and never published. Open a pull request instead; it goes in once a repository owner has approved and merged it. |

What counts as yours:

- **A profile** belongs to the GitHub account in its `github` field.
- **An entry**, and its folder under `public/media/`, belongs to the authors it listed *before* your change. Adding yourself to someone else's entry does not make it yours.
- **Entries with no `authors`, profiles with no `github`**, and anything else under `public/media/` belong to the repository owners.
- **Repository owners** are named on the first line of `.github/CODEOWNERS` and can change anything.

To propose a change to the site's code:

```sh
git switch -c short-description
git add .
git commit -m "What changed"
git push -u origin short-description
```

Open the link git prints, create the pull request, and wait for an owner's approval before merging.

### For owners: undoing a change

Open the **Actions** tab, choose **Undo a change**, press **Run workflow**, and paste the commit id from the Discord alert (or from the commit's page). The commit is reversed on `main` and the site is republished. Only owners can run it.

### Limits

A change to the workflow files under `.github/` cannot be undone automatically (GitHub does not let a workflow rewrite workflows). In that case the site is simply not rebuilt and the owners are alerted to deal with it by hand.

These rules guard against mistakes, not against a determined collaborator: everyone with write access can push to `main`, and the guard itself lives in this repository. An alert arrives after the change is already live. If that ever stops being enough, switch `main` back to pull requests only (Settings → Branches).

## Where the checks run

| When | What happens |
| --- | --- |
| `git push` from your machine (set up by `npm install`) | Entries are checked; an error stops the push |
| A change landing on `main` | Unapproved site-code changes are undone; changes to other people's files are reported to Discord; entries are checked and the site is built. If the check or build fails, the previous version stays up |
| A pull request, or a push to another branch | Entries are checked and the site is built; changes to other people's files are noted on the pull request without blocking it |

The first is a convenience and can be skipped with `git push --no-verify`. The second cannot.

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

### Alerts for the team

The alerts described under [Who can change what](#who-can-change-what) go to a second webhook, so they can live in a team-only channel instead of the public one. Create a webhook in that channel the same way and save its URL as the repository secret `DISCORD_DEVLOG_ALERTS_WEBHOOK`. Without it, alerts appear only in the workflow's log.

To mention people, the workflow needs to know which Discord account goes with which GitHub account. That list is the repository **variable** `DEVLOG_PEOPLE` (Settings → Secrets and variables → Actions → Variables), kept up to date by the Discord bot when someone links their GitHub account. It can also be edited by hand:

```json
[{ "github": "octocat", "discord": "123456789012345678", "author": "their-author-id" }]
```

Anyone not on the list is named in plain text instead of being mentioned.

To try the alerts without changing anything, run **Build and deploy** by hand from the Actions tab and fill in a GitHub user name under "Test the guard only": the last commit is judged as if that person had pushed it, and the message is marked as a test.

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
