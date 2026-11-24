---
title: personal-website Home
tags:
  - personal-website
  - index
type: index
status: active
created: 2026-11-24
---

# personal-website

Vault root for this project. The Obsidian vault opens from `~/Code`, so all
links here use the path from `~/Code`.

## Pages

- [[personal-website/docs/Issue-Workflow.md|Issue Workflow]] - how GitHub issues carry
  state between agent sessions.
- [[personal-website/docs/Documentation-Conventions.md|Documentation Conventions]] -
  properties blocks, linking, and file layout.
- [[personal-website/docs/Hosting.md|Hosting]] - how the site is served, and what
  the old repository still holds.

## Project state

The repository holds a one-page static site for cetaceous.dev. A Cloudflare Worker with static assets serves `public/`, and the Caddyfile serves the same folder for local use.

## Agent instructions

Session rules live in [[personal-website/CLAUDE.md|CLAUDE.md]] at the repository root.
