# weserv/images on Cloudflare Containers

Deploys [weserv/images](../README.md) — the libvips + nginx image proxy — to
[Cloudflare Containers](https://developers.cloudflare.com/containers/), fronted
by a small Worker that forwards every request to the container.

This folder is self-contained and does **not** touch the existing
[`docker/`](../docker) deployment. The image is a standard Docker image, so it
also runs on any Docker host — not just Cloudflare (see [Run locally](#run-locally)).

## What's here

| File | Purpose |
| --- | --- |
| `Dockerfile` | Alpine-based build (~105 MB) of the weserv module from this repo's source. Applies the fixes below. Listens on **8080**. |
| `wrangler.jsonc` | Container + Worker config: `standard-2` instance, up to 5 instances. |
| `src/index.ts` | Worker that spreads requests across the container pool; raises Cloudflare's container start/port timeouts for the cold start. |
| `package.json` / `tsconfig.json` | Wrangler + TypeScript setup. |

### Adaptations applied in the Dockerfile (needed for CF and/or a Windows checkout)

- **CRLF → LF** on `config`/`config.make` and the nginx `*.conf` — a Windows
  `core.autocrlf=true` checkout otherwise breaks nginx's build and config.
- **`/dev/shm` → `/var/cache/nginx`** — Cloudflare has no `--shm-size`; this also
  means no `--shm-size` is needed locally.
- **`error_log stderr`** (the keyword, not the `/dev/stderr` path, which fails
  to open inside Cloudflare's Firecracker microVM).
- **Non-privileged ports** — nginx listens on 8080 (public) / 8081 (internal).

## Run locally

The image works on any Docker host:

```bash
docker build -f cloudflare/Dockerfile -t weserv:local .    # from the repo root
docker run -d -p 8080:8080 --name weserv weserv:local
# http://localhost:8080/clear-cache
# http://localhost:8080/?url=ory.weserv.nl/lichtenstein.jpg&w=300
```

Image resizing needs outbound internet + DNS (nginx resolves origin URLs via
`resolver 8.8.8.8`). If your network blocks that, change the `resolver` in
`ngx_conf/imagesweserv.conf`.

## Deploy to Cloudflare

Prerequisites: Docker running, Node/npm, and a Cloudflare account on the
**Workers Paid** plan (Containers are not on the free plan).

```bash
# from this cloudflare/ directory
npm install                 # first time only
npx wrangler login          # opens your browser
npm run deploy              # builds, pushes, deploys (first build ~4-5 min)
```

If your login has multiple accounts, prefix with the target account:
`CLOUDFLARE_ACCOUNT_ID=<id> npm run deploy`. Wrangler prints your Worker URL
(`https://weserv-images.<subdomain>.workers.dev`).

## ⚠️ Status / known issue

The image is verified working (builds, serves, resizes — confirmed locally).
As of last testing, deploys to Cloudflare succeed but the container **fails to
serve at runtime** with `503 "There is no container instance available"` /
error `1042` / "internal error connecting to the port". This was isolated to a
**Cloudflare-side container capacity/provisioning problem on the account** — a
plain Worker and a trivial hello-world container were also affected, and it is
**not** specific to this image. If you hit this: retry later when capacity
frees up, check the dashboard's container provisioning status, and/or open a
Cloudflare Containers support ticket. Meanwhile the image runs fine anywhere
else (see [Run locally](#run-locally)).

## Notes & tuning

- **Instance size** (`instance_type`): `standard-2` (1 vCPU, 6 GiB, 12 GB disk).
  Bump to `standard-3`/`-4` for throughput, or `standard-1`/`basic` to cut cost.
  See [limits](https://developers.cloudflare.com/containers/platform-details/limits/).
- **Pool size**: keep `max_instances` (`wrangler.jsonc`) and `INSTANCES`
  (`src/index.ts`) in sync — the Worker picks a random instance per request.
- **Caching**: each container has its own local nginx cache; the primary layer
  is Cloudflare's edge CDN in front of the Worker.
- **Cold starts / timeouts**: `src/index.ts` raises Cloudflare's default 8 s/20 s
  container start + port-ready timeouts (the image + libvips take a bit to boot).
  `sleepAfter` controls how long an idle instance stays warm.
- **Custom domain**: add a route in `wrangler.jsonc` or bind one in the dashboard.
