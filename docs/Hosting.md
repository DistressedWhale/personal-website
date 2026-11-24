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
npx wrangler deploy   # publish to cetaceous.dev
```

`bun` is the preferred runner (`bunx wrangler ...`). It was not installed when
this page was written, so the commands show `npx`.

### Domain

The DNS zone for `cetaceous.dev` is on Cloudflare. `wrangler.jsonc` attaches the
Worker as a custom domain. Cloudflare creates the DNS record and the certificate
for it, so the zone needs no A or AAAA record for the apex.

Cloudflare refuses a custom domain while another A, AAAA or CNAME record exists
for the same hostname (API error 100117). The wrangler login has no DNS write
permission, so delete such a record in the dashboard.

The MX and TXT records of the zone belong to Cloudflare Email Routing. Do not
delete them.

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
