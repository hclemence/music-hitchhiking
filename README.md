# Music Hitchhiking

A map of songs you travel through by hitchhiking from one song to the next, with other people's ships docked on the stars.
This repo holds the core logic (`supabase/functions/_shared/core`) and the Supabase backend (migrations, RPCs, the `redeem-invite` edge function).

## Prerequisites

Node 22, pnpm 10, Docker (the Supabase CLI runs the local stack in containers).

## Setup

```
pnpm install
pnpm db:start        # local Postgres, Auth, REST, Realtime, edge runtime (first start pulls images)
pnpm db:reset        # apply supabase/migrations to a clean database
pnpm seed:sample    # optional: load the sample song map (needs the stack running; idempotent)
```

`pnpm supabase status -o env` prints the local URL and keys.

## Tests

| Suite | Command | Needs |
| --- | --- | --- |
| Core unit tests (Vitest) | `pnpm test` | nothing |
| Database tests (pgTAP) | `pnpm test:db` | stack running |
| Integration tests (`redeem-invite`) | `pnpm test:integration` | stack running and `pnpm functions:serve` in a second terminal |

Integration tests read the stack's connection details from `supabase status`, or from `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` if all three are set. Also run `pnpm exec tsc -p .` for type checks.

## App

The phone-first web app lives in `app/` (Vite, React, React Three Fiber).

- **Live:** `VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... pnpm app:dev` (the URL and anon key are `API_URL` and `ANON_KEY` from `pnpm supabase status -o env`). Needs the stack running, `pnpm seed:sample`, and `pnpm functions:serve` for invites.
- **Demo:** `VITE_BACKEND=demo pnpm app:dev` (or no Supabase URL at all) runs over the sample map in the browser with `DemoBackend`: no accounts, traces or inbox.
- **Unit tests:** `pnpm app:test` (Vitest + jsdom, needs nothing). Type check: `pnpm exec tsc -p app`.
- **End-to-end:** `pnpm app:e2e` builds the demo, then runs Playwright (Chromium at 390×844 with touch):
  - `live`: two people redeem invites, dock, explore one encounter at a time, like each other's ships from the pop-up, send a song and reply, against the local stack. B's start song is chosen with core `nextEncounter` over the sample map so A's dock is B's first encounter (Wait, up to 40 times, is the fallback). Needs the stack running, `pnpm seed:sample` and `pnpm functions:serve`; it starts its own Vite dev server on port 5199 and deletes the users it made. Takes about 3 minutes (software WebGL, 1x pixel ratio). Screenshots (`e2e2-*.png`) go to `app/test-results/e2e-screens` (or `E2E_SCREENSHOT_DIR`).
  - `demo`: opens `app/dist-demo/index.html` from disk with every non-local request aborted and goes Ship → Dock → map → first pop-up → Wait → second encounter → Hitchhike. `pnpm --filter app exec playwright test --project=demo` runs it alone and needs no stack: the Supabase stack is only looked up when the `live` project runs.
- **Performance probe (report only):** `pnpm --filter app exec tsx e2e/perf.probe.ts` opens the dev-only `/?perf=1` harness (10,000 random stars, 200 docks on the real map scene) in headless Chromium with SwiftShader and prints the average frame time over 5 s. Software rendering is not a real-GPU number.
- **Demo build:** `pnpm app:build:demo` writes one self-contained file, `app/dist-demo/index.html` (about 1.4 MB: app, sample map and styles inlined, system fonts, no network at runtime), for publishing as a single page.

Run `pnpm test:db` before `pnpm seed:sample`: the pgTAP fixtures expect an unseeded database.

## Creating invites

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm tsx scripts/create-invites.ts 5 --days 30
```

Prints one code per line; only hashes are stored. A person redeems one through the `redeem-invite` function, which needs a signed-in (anonymous) user and a client-generated secret (see `supabase/functions/redeem-invite/index.ts`).

## API limits

`supabase/config.toml` sets `[api] max_rows = 20000` so the map (about 10k stars) is not silently truncated at the default 1000. A hosted project needs the same setting (or clients must page with `.order('id').range()`).

## Cloud sandbox notes

Only needed in restricted-network sandboxes; with normal internet access use the plain scripts above.

- Use the `:sandbox` variants (`db:start:sandbox`, `db:reset:sandbox`, `test:db:sandbox`, `functions:serve:sandbox`). They set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` (images come from Docker Hub instead of the default registry) and skip services the tests do not use. Realtime is not skipped.
- `dockerd` may not be running; start it first (`dockerd &`) and wait for `docker info`.
- The edge-runtime container does not trust the sandbox's egress CA, so `npm:@supabase/supabase-js` fails to load with `UnknownIssuer`. Do not disable TLS verification. Instead warm the container's persistent Deno cache once: run a throwaway `supabase/edge-runtime:v1.77.9` container that mounts the volume `supabase_edge_runtime_music-hitchhiking` at `/root/.cache/deno` and the host CA bundle (`-v /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates.crt:ro`), sets `-e DENO_TLS_CA_STORE=system`, and imports `npm:@supabase/supabase-js@2`. After that `functions serve` works from the cache. Repeat if the volume is deleted. Details: `.superpowers/sdd/2026-11-02-core-and-backend/task-9-report.md`.
