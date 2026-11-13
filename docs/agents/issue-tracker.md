# Issue tracker: GitHub

Repository issues and specs live in GitHub Issues at
`kingslayerrq/heritage-devlog`. Use the `gh` CLI from this clone.

## Target repository

Before the first issue write in a session, verify the target with
`gh repo view --json nameWithOwner`. The expected repository is
`kingslayerrq/heritage-devlog`. If it differs, resolve the target with the user.

## Conventions

- Create: `gh issue create --title "..." --body-file <path>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Add label filters as needed; use pagination when a complete inventory is required.
- Update a body: `gh issue edit <number> --body-file <path>`.
- Comment: `gh issue comment <number> --body-file <path>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or
  `gh issue edit <number> --remove-label "..."`.
- Close: post the explanation separately, then run `gh issue close <number>`.

For multiline bodies and comments, write the exact text to a temporary UTF-8 file
and pass it with `--body-file`. Preserve newlines and literal shell characters.
Use the vocabulary in [Triage labels](triage-labels.md).

## Parent issues and blockers

Use native GitHub relationships when available:

- Create a child: `gh issue create --parent <parent> --title "..." --body-file <path>`.
- Attach an existing child: `gh issue edit <parent> --add-sub-issue <child>`.
- Add a blocker: `gh issue edit <child> --add-blocked-by <blocker>`.
- Count open blockers:
  `gh api repos/kingslayerrq/heritage-devlog/issues/<number> --jq .issue_dependencies_summary.blocked_by`.

These relationship flags require `gh` 2.94 or later.
When native relationships are unavailable, put `Part of #<parent>` and
`Blocked by: #<number>` at the top of the child body, and list children in the
parent's task list. A ticket is unblocked when every blocker is closed.
Treat missing dependency data as unknown, not zero.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the corresponding GitHub issue.

## Wayfinding operations

- Keep the map in one issue labelled `wayfinder:map`, with Notes,
  Decisions-so-far, and Fog sections.
- Link child tickets as sub-issues, or use the parent/task-list fallback above.
  Label children `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- Select the first open child in map order with no assignee and no open blockers.
- Claim with `gh issue edit <number> --add-assignee "@me"`.
- Resolve by commenting with the result, closing the child, and adding a concise
  finding and link to the map's Decisions-so-far section.

Create any required wayfinder labels when that workflow is first used.
