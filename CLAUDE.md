# personal-website

## Issue workflow

Use the `gh` CLI for all issue work. GitHub issues are the working memory between
agent sessions. Any new agent must be able to run `gh issue view <n>` and start
work with no other context.

- Read an issue: `gh issue view <n> --comments`
- List open work: `gh issue list`
- Open new work: `gh issue create --title "..." --body "..."`
- Close finished work: `gh issue close <n> --comment "<what changed>"`

Rules:

- Write issues for a reader who knows nothing about the session that created them.
  State the goal, the affected files, and the definition of done.
- Post a comment on the issue when you learn something a later agent needs.
  Decisions, dead ends, and file paths belong there.
- Close the issue in the same session that finishes the work.
- If work stops part way, comment with the current state before you stop.

## Commits

Group 1-3 closed issues into one commit. Judge the split by the size of the code
change. A large change is its own commit. Several small related fixes share one.

Commit messages follow the comment rules: short and descriptive. Name the issue
the commit closes.

```
add rate limit to poll loop (closes #14)
fix dashboard tile alignment; drop unused css (closes #21, #22)
```

## Tooling

Use these tools. The older tool is a fallback, not a default.

| Use | Not | For |
| --- | --- | --- |
| `fd` | `find` | file search |
| `rg` | `grep` | text search |
| `uv` | `pip` | Python packages and environments |
| `bun` | `npm` | JavaScript packages and scripts |
| Rust 2024 edition | Rust 2021 | new crates |

Fall back only when the preferred tool is missing or cannot do the job. Say why
when you do.

## Comments

Code comments are 1-2 sentences. No longer.

- Dry ASD-STE100 style is preferred. One idea per sentence, active voice, no idioms.
- Fall back to normal speech when it explains the thing better.
- No AI jargon. Do not write phrases like "the bounding seam" or
  "the load bearing smoking gun".
- Explain why the code does a thing, not what the line says.

## Docs

All documentation lives in `/docs/`. The folder is an ObsidianMD vault.

- Every file starts with a YAML properties block. Include `tags` at minimum.
- Link between docs with wiki links.
- The vault opens from `~/Code`, so bare filenames are ambiguous. Many
  subdirectories hold a `README` or `LICENSE`. Always link with the path from
  `~/Code`, for example `[[personal-website/docs/Home.md|Home]]`.
- Start at [[personal-website/docs/Home.md|Home]] and link new pages from there.
