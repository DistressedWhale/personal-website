# personal-website

Source of cetaceous.dev.

The site is static. All served files live in `public/`.

## Home page

The home page is a three.js scene: a blue whale that swims through open ocean,
followed by a chase camera. Code draws everything. The site holds no image or
model files.

| File | Content |
| --- | --- |
| `public/scene/main.js` | Renderer, whale motion, camera path and drag control, light shaft pass |
| `public/scene/whale.js` | Whale shape, swim bend, skin shader |
| `public/scene/ocean.js` | Wave textures, sea surface, backdrop, drifting specks |
| `public/scene/fish.js` | Sardine schools, simulated as boids |
| `public/scene/creatures.js` | Tuna packs, pilot fish, manta rays, jellyfish |
| `public/scene/seafloor.js` | Sand floor, whale shadow, two shipwrecks |
| `public/scene/glsl.js` | Water colour, fog and caustic code shared by all shaders |
| `public/scene/noise.js` | Seeded random numbers and the tileable noise texture |
| `public/vendor/three/` | three.js r187, bundled to one minified file with esbuild |

The scene has no end. JavaScript keeps time in double precision and wraps each
value before it goes to a shader, so the picture does not degrade over days.

Address parameters fix one view for checks: `?t=120` sets the start time in
seconds, `?az=0.5&el=0.2&dist=40` fix the camera angle and distance, and
`?rays=0` turns the light shafts off, and `?focus=` points the camera at
something other than the whale: `tuna`, `manta`, `jelly`, `ball`, `ring`,
`stream` or `wreck`.

A drag with the left mouse button, or one finger, turns the camera around the
whale. Six seconds after release the camera eases back to its own path.

## Fish simulation

The sardines are boids. Each fish steers by three rules about the fish near it:
keep clear, match heading, stay together. A hash grid finds the near fish, and
the neighbour rules run on every second frame for each school.

Each school adds one rule for its pattern:

| Pattern | Rule |
| --- | --- |
| Ball | Stay inside a sphere that slowly swells and shrinks, and circle its upright axis |
| Ring | Hold a circle of fixed radius and swim around it |
| Stream | Follow a slowly turning course as one long ribbon |

Every fish flees from the whale, the tuna and the manta rays. A tuna pack picks
a ball when it sets off and swims through it, which tears the ball open.

To update three.js, download the `three` package and run, in its `build` folder:

```sh
npx esbuild three.module.js --bundle --minify --format=esm --outfile=three.module.min.js
```

## Cloudflare Worker

`wrangler.jsonc` defines a Worker with static assets and no script. Cloudflare
serves `public/` and handles TLS and compression.

```sh
npx wrangler dev      # local preview on http://localhost:8787
npx wrangler deploy   # publish to cetaceous.dev
```

`bun` is the preferred runner (`bunx wrangler ...`). It was not installed when
this file was written, so the commands show `npx`.

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
