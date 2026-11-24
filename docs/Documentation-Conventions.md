---
title: Documentation Conventions
tags:
  - personal-website
  - process
  - obsidian
type: process
status: active
created: 2026-11-24
---

# Documentation Conventions

All docs live in `personal-website/docs/`. The folder is an ObsidianMD vault section.

## Properties block

Every file opens with a YAML properties block. `tags` is required. Add other
fields when they help.

```yaml
---
title: Page Title
tags:
  - personal-website
  - process
type: process
status: active
created: 2026-11-24
---
```

Common values for `type`: `index`, `process`, `reference`, `decision`, `note`.
Common values for `status`: `active`, `draft`, `superseded`.

## Links

The vault opens from `~/Code`. Many subdirectories hold files named `README` or
`LICENSE`, so a bare filename is ambiguous. Link with the full path from `~/Code`
and add a display name.

```
[[personal-website/docs/Home.md|Home]]
[[personal-website/CLAUDE.md|CLAUDE.md]]
```

Do not write `[[Home]]` or `[[README]]`.

## Structure

Link every new page from [[personal-website/docs/Home.md|Home]]. A page nobody links
to is lost.

## Related

- [[personal-website/docs/Home.md|Home]]
- [[personal-website/docs/Issue-Workflow.md|Issue Workflow]]
