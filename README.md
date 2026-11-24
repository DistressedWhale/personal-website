# personal-website

Source of cetaceous.dev.

The site is static. All served files live in `public/`.

## Home page

The home page is a three.js scene: a blue whale that swims through open ocean,
followed by a chase camera. Code draws everything. The site holds no image or
model files.

| File | Content |
| --- | --- |
| `public/scene/main.js` | Start-up and the frame loop: creates every part and updates them in order |
| `public/scene/glsl.js` | Shader code shared by all materials: water colour, fog, caustics, sea floor height, lighting |
| `public/scene/util.js` | Small helpers: seeded random numbers, geometry and mesh makers, the full-screen quad |
| `public/scene/noise.js` | The tileable noise texture |
| `public/scene/camera.js` | Chase camera: its path, the mouse nudge and the drag control |
| `public/scene/post.js` | Light shaft pass, tone mapping, and the adaptive render scale |
| `public/scene/ocean.js` | Wave textures, sea surface, backdrop, drifting specks |
| `public/scene/whale.js` | Whale shape, swim bend, skin shader, and the whale's motion |
| `public/scene/fish.js` | Sardine schools, simulated as boids |
| `public/scene/packs.js` | Tuna packs and pilot fish, which share one body and shader |
| `public/scene/manta.js` | Manta rays |
| `public/scene/jelly.js` | Jellyfish blooms |
| `public/scene/seafloor.js` | Sand floor, whale shadow, wreck material and placement |
| `public/scene/wrecks.js` | Shipwreck models: a wooden sailing ship and a steamer broken in two |
| `public/scene/builder.js` | Model builder that the wrecks use: boxes, bars, curved patches |
| `public/vendor/three/` | three.js r187, bundled to one minified file with esbuild |

Each part is a `create...` function that returns an object with an `update` method. `main.js` is the only
file that knows all the parts, so it is the place to start reading.

The scene has no end. JavaScript keeps time in double precision and wraps each
value before it goes to a shader, so the picture does not degrade over days.

Address parameters fix one view for checks: `?t=120` sets the start time in
seconds, `?az=0.5&el=0.2&dist=40` fix the camera angle and distance, `?rays=0`
turns the light shafts off, `?still` freezes time, and `?focus=` points the
camera at something other than the whale: `tuna`, `manta`, `jelly`, `ball`,
`roam`, `split`, `stream`, `wreck` or `wreck2`.

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
| Roam | Swim toward a point that wanders, so the school keeps changing shape |
| Split | Like roam, with two points that drift apart and back, so the school divides and rejoins |
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
