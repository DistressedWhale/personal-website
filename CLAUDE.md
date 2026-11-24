# personal-website

## Commits

Commit messages are short and descriptive, like code comments.

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
