---
title: Hosting
tags:
  - personal-website
  - reference
  - cloudflare
type: reference
status: active
created: 2026-11-24
---

# Hosting

The site is static. All served files live in `public/`.

## Cloudflare Worker

`wrangler.jsonc` defines a Worker with static assets and no script. Cloudflare
serves `public/` and handles TLS and compression.

```sh
npx wrangler dev      # local preview on http://localhost:8787
npx wrangler deploy   # publish to the workers.dev address
```

`bun` is the preferred runner (`bunx wrangler ...`). It was not installed when
this page was written, so the commands show `npx`.

The DNS zone for `cetaceous.dev` is already on Cloudflare. The Worker is not yet
attached to the domain. To attach it, add this to `wrangler.jsonc` and deploy:

```jsonc
"routes": [{ "pattern": "cetaceous.dev", "custom_domain": true }]
```

Cloudflare refuses a custom domain while a DNS record for the same hostname
exists. Delete the old records that pointed at Google Cloud Run first.

## Caddy

`Caddyfile` serves `public/` on port 8080. Use it for a local preview without
wrangler, or to self-host.

```sh
caddy run
```

## Old repository

`DistressedWhale/chlo-personal-website` (private) is the previous version. It ran
Caddy in a container on Google Cloud Run.

| Path | Branch | Use now |
| --- | --- | --- |
| `helloworld/Caddyfile` | `master` | Source of the current page text. Ported. |
| `frontend/` | `development` | Next.js 16 app: home page, navbar, `/dwtssolver` tool with hull piece images. Not ported. |
| `terraform/`, `.github/workflows/` | both | Google Cloud only. Not needed on Cloudflare. |
| `consumer/`, `api/` | `master` | Network Rail STOMP consumer and FastAPI. Not part of the site. |

## Related

- [[personal-website/docs/Home.md|Home]]
