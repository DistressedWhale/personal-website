---
title: Issue Workflow
tags:
  - personal-website
  - process
  - agents
type: process
status: active
created: 2026-11-24
---

# Issue Workflow

GitHub issues are the working memory of this project. An agent session ends and
its context is lost. The issue keeps what the next session needs.

## Target

A user can say "pick up issue 12" and nothing else. The agent reads the issue and
starts work.

## Commands

```sh
gh issue list                       # open work
gh issue view <n> --comments        # read one issue and its history
gh issue create --title "..." --body "..."
gh issue comment <n> --body "..."   # record a decision or a dead end
gh issue close <n> --comment "..."  # close when the work is done
```

## Writing an issue

Include four things:

1. The goal, in one or two sentences.
2. The files or areas affected.
3. The definition of done.
4. Any constraint that is not obvious from the code.

## During work

Comment on the issue when you learn something a later session needs. Record
decisions, rejected approaches, and file paths. If you stop before the work is
done, comment with the current state first.

## Closing

Close the issue in the session that finishes the work. The closing comment states
what changed.

## Commits

One commit covers 1-3 closed issues. The size of the code change decides the
split. A large change gets its own commit. Small related fixes share one.

Messages are short and descriptive, like code comments. Name the issue the commit
closes.

```
add rate limit to poll loop (closes #14)
fix dashboard tile alignment; drop unused css (closes #21, #22)
```

## Related

- [[personal-website/docs/Home.md|Home]]
- [[personal-website/docs/Documentation-Conventions.md|Documentation Conventions]]
