# Music Hitchhiking — Plan 1: Core Logic and Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared pure logic (encounters, placement, area colours, recovery codes) and the Supabase backend (schema, access rules, RPCs, brightness, invites) that Plans 2 (songs) and 3 (client) build on.

**Architecture:** One pnpm repo. Pure TypeScript logic lives in `supabase/functions/_shared/core/` so both Edge Functions (Deno) and the Vite client can import it; it is tested with Vitest. The database is Supabase Postgres: base tables are locked down, clients read through member-only views and write only through `security definer` RPCs, so no user id ever reaches another person's phone. Brightness is a SQL function scheduled hourly by `pg_cron`.

**Tech Stack:** Node 22, pnpm 10, TypeScript (strict), Vitest, Supabase CLI (devDependency, needs Docker), Postgres 15+ with pgTAP and pg_cron, `@supabase/supabase-js` v2.

**Spec:** `docs/superpowers/specs/2026-11-02-music-hitchhiking-design.md`

**Later plans:** Plan 2 adds `ingest_jobs`, `search_cache`, the `songs` function, the seed script and the nightly `local_radius` refresh. Plan 3 is the client.

## Global Constraints

- Core TS (`supabase/functions/_shared/core/`): no runtime dependencies, no Node- or Deno-only APIs (Web Crypto allowed), relative imports with explicit `.ts` extensions.
- No view, RPC result or readable table may expose another person's `user_id`. `visits` and `hops` never store who took you there.
- Visit weights: dock 1.0, like 0.6, suggestion 0.5, hop 0.4, start 0.3. Star half-life 72 hours. Active threshold 0.03. Docked-by-real-person = 1. Sample-only floor 0.15. Visits older than 30 days deleted.
- Trace brightness `0.5^(days_since_last_exchange / 7)`; hidden below 0.1.
- Day boundary: 4:00 local time.
- Encounters: 3 per hop — 2 at distance < r/2, 1 at r/2 ≤ d ≤ r; widen r ×1.5, max 6 widenings, then nearest.
- Placement: offset up to 10% of mean neighbour `local_radius`; island shell radius 1100–1200; neighbours placed at `(1 − weight) × local_radius`; `local_radius` = distance to 30th nearest.
- At most 3 unseen suggestions per trace direction.
- 12 ship colours (exact values in Task 3).

**Plan decisions beyond the spec** (implementation detail, not behaviour changes):
- Account recovery uses Supabase password auth: redeeming an invite turns the anonymous user into one with a synthetic email and a random secret; the recovery code encodes both. `profiles.recovery_hash` is therefore dropped.
- Brightness runs as SQL `tick_brightness()` scheduled by `pg_cron` instead of an Edge Function.
- Clients read traces and the inbox through `my_traces` / `my_inbox` views, not the base tables.
- A `regions` table holds area centroids and adjacency (seeded in Plan 2).

## Review Focus

1. An anonymous user who never redeemed an invite reads views or calls RPCs → views return no rows, RPCs raise `not_member`. (Task 5)
2. Same invite redeemed twice at once → exactly one succeeds. (Task 9)
3. `hop`/`move_to` given a hop from another person's or yesterday's journey → raises `bad_hop`. (Task 6)
4. An invalid time-zone string from the phone → raises `invalid_time_zone`, nothing written. (Task 6)
5. Liking your own dock or a sample dock, or sending along a faded trace → own dock raises `own_dock`; sample creates a like but no trace; faded trace raises `trace_faded`. (Task 7)

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.json, vitest.config.ts, .gitignore
supabase/config.toml                      # supabase init; anonymous sign-ins on
supabase/functions/_shared/core/
  types.ts        Vec3, Star, PublicDock, Encounter
  rng.ts          seededRng
  vec.ts          distance, add, scale, randomUnitVector
  encounters.ts   findEncounters
  placement.ts    placeSong, placeAround, computeLocalRadius, nearestRegion
  palette.ts      SHIP_COLOURS, regionPalette
  recovery.ts     encode/decodeRecoveryCode, recoveryEmail, hashInviteCode, generateInviteCode
  *.test.ts
supabase/migrations/
  20261102000100_schema.sql
  20261102000200_access.sql
  20261102000300_journey_rpcs.sql
  20261102000400_trace_rpcs.sql
  20261102000500_brightness.sql
  20261102000600_invites.sql
supabase/tests/*.test.sql                 # pgTAP, run by `pnpm supabase test db`
supabase/functions/redeem-invite/index.ts
scripts/create-invites.ts
tests/integration/redeem-invite.test.ts   # against the local stack
```

---

### Task 1: Repo scaffold and `findEncounters`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `supabase/functions/_shared/core/{types,rng,vec,encounters}.ts`
- Test: `supabase/functions/_shared/core/{rng,encounters}.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }`
  - `type Star = Vec3 & { id: string; localRadius: number; regionId: number; brightness: number }`
  - `type PublicDock = { id: string; songId: string; isSample: boolean; shipColour: string; updatedAt: string }`
  - `type Encounter = { songId: string; dock: PublicDock; othersCount: number; distance: number }`
  - `seededRng(seed: string): () => number` — deterministic, values in [0, 1)
  - `distance(a: Vec3, b: Vec3): number`, `add`, `scale(v, k)`, `randomUnitVector(rng): Vec3`
  - `findEncounters(args: { current: Star; stars: ReadonlyMap<string, Star>; docks: readonly PublicDock[]; ownDockId: string | null; pathSongIds: ReadonlySet<string>; seenDockIds: ReadonlySet<string>; rng: () => number }): Encounter[]`

- [ ] **Step 1: Scaffold.** `pnpm init`; devDependencies `typescript vitest supabase @supabase/supabase-js`; scripts `test` = `vitest run supabase/functions/_shared`, `test:db` = `supabase test db`, `test:integration` = `vitest run tests/integration`. `tsconfig.json`: `strict`, `noEmit`, `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `target: "ES2022"`, `lib: ["ES2022","DOM"]`. `.gitignore`: `node_modules`, `.env*`, `supabase/.temp`, `supabase/.branches`.

- [ ] **Step 2: Write failing tests.**

```ts
// rng.test.ts
test('same seed gives same sequence', () => {
  const a = seededRng('x'), b = seededRng('x');
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
test('values in [0,1) and seeds differ', () => {
  const r = seededRng('y'); const vals = Array.from({ length: 1000 }, r);
  expect(vals.every(v => v >= 0 && v < 1)).toBe(true);
  expect(seededRng('a')()).not.toBe(seededRng('b')());
});

// encounters.test.ts — helper: star(id, x, r=10) puts a star on the x-axis; dock(id, songId, updatedAt?)
// current = star('c', 0, 10)
test('returns 2 near (<5) then 1 far (5..10)', ...)          // stars at 2,3,4 (near), 7,8 (far)
  // expect length 3; first two distances < 5; third in [5,10]
test('excludes own dock, current song, path songs, seen docks, inactive songs', ...)
  // docks on: own dock at 2, song 'p' (in pathSongIds) at 3, seen dock at 4, song missing from stars at 2.5,
  // valid near at 1 and 4.5, valid far at 6 → result songIds exactly {near1, near4.5, far6}
test('groups docks per song: newest shown, othersCount counts the rest', ...)
  // 3 docks on one song with updatedAt t1<t2<t3 → dock.id is t3's, othersCount 2
test('widens radius ×1.5 when a band is short', ...)
  // near at 6 and 7, far at 10, nothing else → after one widening (r=15: near <7.5, far 7.5..15) returns all three
test('after 6 widenings returns nearest 3', ...)
  // 5 docks all at distance 1 → returns 3 with distance 1
test('fewer than 3 candidates returns all, nearest first', ...)
  // 2 docks at 9 and 3 → [3, 9]
test('deterministic for a given rng seed', ...)
```

- [ ] **Step 3: Run** `pnpm test` → FAIL (modules not found).

- [ ] **Step 4: Implement** `rng.ts` (string hash → mulberry32), `vec.ts`, `encounters.ts`.
  Algorithm: filter docks (not own, not seen, song in `stars`, song ≠ current, song ∉ path) → group by song, show newest by `updatedAt`, `othersCount = size − 1` → compute distances → loop `r = current.localRadius`, up to 6 widenings: near = `d < r/2`, far = `r/2 ≤ d ≤ r`; if near ≥ 2 and far ≥ 1, shuffle each band with `rng` (Fisher–Yates) and return `[near0, near1, far0]`; else `r *= 1.5`. After the loop return the 3 nearest.

- [ ] **Step 5: Run** `pnpm test` → PASS.

- [ ] **Step 6: Commit** `feat(core): scaffold repo and add findEncounters`

---

### Task 2: Placement

**Files:**
- Create: `supabase/functions/_shared/core/placement.ts`
- Test: `supabase/functions/_shared/core/placement.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `distance`, `randomUnitVector`, `seededRng` (Task 1)
- Produces:
  - constants `ISLAND_MIN_RADIUS = 1100`, `ISLAND_MAX_RADIUS = 1200`, `OFFSET_FRACTION = 0.1`, `LOCAL_RADIUS_K = 30`, `DEFAULT_LOCAL_RADIUS = 100`
  - `type Neighbour = { position: Vec3 | null; weight: number; localRadius: number | null }`
  - `placeSong(neighbours: readonly Neighbour[], rng: () => number): { position: Vec3; island: boolean }`
  - `placeAround(anchor: Vec3, weight: number, localRadius: number, rng: () => number): Vec3`
  - `computeLocalRadius(p: Vec3, others: readonly Vec3[], k?: number): number`
  - `nearestRegion(p: Vec3, centroids: readonly Vec3[]): number` (index)

- [ ] **Step 1: Write failing tests.**

```ts
test('placeSong lands within 10% of mean localRadius of the weighted mean', () => {
  // neighbours: (0,0,0) w=1 r=50, (10,0,0) w=3 r=150 → mean (7.5,0,0), meanR 100
  // over 200 seeds: distance(position, (7.5,0,0)) <= 10 and island === false
});
test('ignores neighbours without position or with weight 0', ...)
test('no positioned neighbours → island on shell 1100..1200', ...)  // 200 seeds, |p| in [1100,1200], island true
test('placeAround puts point at (1 - weight) * localRadius from anchor', ...)  // w=0.25 r=40 → distance 30 ±1e-9
test('computeLocalRadius is distance to k-th nearest', ...)  // others at 1..40 on x-axis, k=30 → 30
test('computeLocalRadius with fewer than k others → farthest; none → DEFAULT_LOCAL_RADIUS', ...)
test('nearestRegion returns index of closest centroid', ...)
```

- [ ] **Step 2: Run** `pnpm test` → FAIL.
- [ ] **Step 3: Implement** `placement.ts`. Weights are clamped to [0, 1]; null `localRadius` counts as `DEFAULT_LOCAL_RADIUS`; offset length = `rng() * OFFSET_FRACTION * meanR` along `randomUnitVector(rng)`.
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(core): add song placement`

---

### Task 3: Area palette and ship colours

**Files:**
- Create: `supabase/functions/_shared/core/palette.ts`
- Test: `supabase/functions/_shared/core/palette.test.ts`

**Interfaces:**
- Consumes: `seededRng` (Task 1)
- Produces:
  - `SHIP_COLOURS: readonly string[]` = `['#e8554e','#f08a3c','#f2c14e','#9bd45a','#3fbf7f','#2fb5b5','#3a9be0','#5b6cf0','#9361e8','#d65ad1','#f07aa6','#e9e4d8']`
  - `regionPalette(colourSeed: string, regionCount: number, adjacency: readonly (readonly [number, number])[]): string[]` — one `#rrggbb` per region

- [ ] **Step 1: Write failing tests.**

```ts
test('SHIP_COLOURS has 12 unique hex colours', ...)
test('same seed → same palette; different seed → different palette', ...)  // 40 regions, ring adjacency
test('adjacent regions never share a colour', ...)   // complete graph on 12 regions, and 40-region random graph with degree ≤ 20
test('returns regionCount valid hex strings', ...)    // /^#[0-9a-f]{6}$/
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Candidate colours: `n = max(24, maxDegree + 1)` HSL colours, hue `(h0 + i × 137.508°) mod 360` with `h0 = rng() × 360`, alternating lightness 55% / 70%, saturation 65%. Visit regions in seeded-shuffled order; for each, start at a seeded random candidate index and take the first candidate not used by an already-coloured neighbour.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): add area palette and ship colours`

---

### Task 4: Database schema

**Files:**
- Create: `supabase/config.toml` (via `pnpm supabase init`; set `[auth] enable_anonymous_sign_ins = true`)
- Create: `supabase/migrations/20261102000100_schema.sql`
- Test: `supabase/tests/01_schema.test.sql`

**Interfaces:**
- Produces: the tables below (later tasks and plans use these exact names).

- [ ] **Step 1: Start local stack.** `pnpm supabase start` → prints API URL, anon key, service key.

- [ ] **Step 2: Write failing pgTAP test** — `has_table` for every table below; `has_column` for every listed column; `col_is_unique('songs','mbid')`; `col_is_unique('docks','user_id')`; check constraint rejects `docks(is_sample=true, user_id=<uuid>)`; check rejects `hops(kind='hitchhike', parent_hop_id null)`; `hasnt_column` on `hops` for any of `user_id`, `from_user`, `dock_id`; `hasnt_column('visits','user_id')`.

- [ ] **Step 3: Run** `pnpm test:db` → FAIL.

- [ ] **Step 4: Write the migration.** Enums `song_status (active, inactive)`, `song_origin (seed, ingest)`, `visit_kind (dock, like, suggestion, hop, start)`, `hop_kind (start, hitchhike, jump)`. All ids `uuid default gen_random_uuid()` unless noted; all `created_at timestamptz not null default now()`.

| Table | Columns and constraints |
|---|---|
| regions | id int pk, x/y/z real, adjacent int[] not null default '{}' |
| songs | id, mbid uuid unique not null, title, artist text not null, x/y/z real not null, region_id int → regions, local_radius real > 0, spotify_url/apple_url/youtube_url text not null, brightness real default 0, status song_status default 'inactive', origin song_origin not null, created_at; index on status |
| song_neighbours | song_id, neighbour_id → songs on delete cascade, weight real check 0..1, pk (song_id, neighbour_id) |
| visits | id bigint identity pk, song_id → songs cascade, kind visit_kind, created_at; indexes on created_at, song_id |
| profiles | user_id pk → auth.users cascade, home_song_id → songs null, colour_seed text not null, ship_colour text check `~ '^#[0-9a-f]{6}$'`, created_at |
| invites | id, code_hash text unique, created_at, expires_at not null, redeemed_by → auth.users null, redeemed_at null |
| docks | id, user_id → auth.users cascade unique null, song_id → songs, is_sample bool default false, ship_colour text, updated_at default now(); check `is_sample = (user_id is null)`; index on song_id |
| journeys | id, user_id → auth.users cascade, day date, start_song_id → songs, current_hop_id → hops (deferrable initially deferred), created_at; unique (user_id, day) |
| hops | id, journey_id → journeys cascade, parent_hop_id → hops null, song_id → songs, kind hop_kind, created_at; check `(kind = 'start') = (parent_hop_id is null)` |
| likes | id, user_id → auth.users cascade, song_id → songs, created_at; unique (user_id, song_id) |
| traces | id, holder_id, target_id → auth.users cascade, origin_song_id → songs, created_at, last_exchange_at default now(), brightness real default 1; unique (holder_id, target_id); check holder ≠ target |
| suggestions | id, trace_id → traces cascade, from_id, to_id → auth.users cascade, song_id → songs, created_at, seen_at null |
| kept_notices | id, owner_id → auth.users cascade, song_id → songs, created_at, seen_at null |

- [ ] **Step 5: Run** `pnpm supabase db reset && pnpm test:db` → PASS.
- [ ] **Step 6: Commit** `feat(db): add schema`

---

### Task 5: Access rules and member views

**Files:**
- Create: `supabase/migrations/20261102000200_access.sql`
- Test: `supabase/tests/02_access.test.sql`

**Interfaces:**
- Consumes: Task 4 tables
- Produces:
  - `is_member() returns boolean` — caller has a `profiles` row
  - `require_member() returns uuid` — returns `auth.uid()` or raises `not_member`
  - views (owner rights, each filtered by `is_member()`): `active_stars(id, title, artist, x, y, z, region_id, local_radius, brightness, spotify_url, apple_url, youtube_url)`, `public_docks(id, song_id, is_sample, ship_colour, updated_at)` (only docks on active songs), `map_regions(id, x, y, z, adjacent)`
  - row-level select for owner on `profiles`, `journeys`, `hops` (via journey), `likes`
  - test helper pattern used by all later pgTAP files: `create function pg_temp.login(uid uuid)` setting `request.jwt.claims` to `{"sub": uid, "role": "authenticated"}` and `set local role authenticated`

- [ ] **Step 1: Write failing pgTAP tests.** Fixtures: users A, B (member, with profiles) and C (in `auth.users`, no profile); 3 songs (2 active, 1 inactive); A docked at an active song; a sample dock.
  - As A: `active_stars` count = 2; `public_docks` has 2 rows; `public_docks` has no `user_id` column (`hasnt_column`); `select from profiles` returns only A's row; selecting `visits`, `invites`, `traces`, `suggestions`, `kept_notices`, `song_neighbours`, `songs` raises `42501` (permission denied).
  - As C (non-member): `active_stars`, `public_docks`, `map_regions` return 0 rows; `select require_member()` raises `not_member`.
  - As `anon` role: every view raises `42501`.
- [ ] **Step 2: Run** `pnpm test:db` → FAIL.
- [ ] **Step 3: Write the migration.** Enable RLS on every table. Revoke all on all tables from `anon, authenticated`. Grant select on the three views and on `profiles, journeys, hops, likes` to `authenticated`; owner-only policies on those four. Views are created without `security_invoker`, with `where public.is_member()`.
- [ ] **Step 4: Run** `pnpm supabase db reset && pnpm test:db` → PASS.
- [ ] **Step 5: Commit** `feat(db): lock down tables and add member views`

---

### Task 6: Dock, ship and journey RPCs

**Files:**
- Create: `supabase/migrations/20261102000300_journey_rpcs.sql`
- Test: `supabase/tests/03_journey_rpcs.test.sql`

**Interfaces:**
- Consumes: `require_member()` (Task 5)
- Produces (all `security definer`, `set search_path = public`, execute granted to `authenticated` only):
  - `journey_day(ts timestamptz, tz text) returns date` — `((ts at time zone tz) - interval '4 hours')::date`; raises `invalid_time_zone` if `tz` not in `pg_timezone_names`
  - `set_dock(p_song_id uuid) returns uuid` — upsert caller's dock (ship colour copied from profile), insert `dock` visit, set song `brightness = 1, status = 'active'`
  - `set_home(p_song_id uuid) returns void`
  - `set_ship_colour(p_colour text) returns void` — updates profile and caller's dock
  - `current_journey(p_tz text) returns table(journey_id uuid, current_hop_id uuid, start_song_id uuid)` — today's journey or no rows
  - `start_journey(p_tz text, p_song_id uuid) returns uuid` (root hop id) — raises `journey_exists` if one exists today; inserts `start` visit
  - `hop(p_tz text, p_parent_hop_id uuid, p_song_id uuid, p_kind hop_kind) returns uuid` — `p_kind` must be `hitchhike` or `jump`; parent must be in caller's today journey (`bad_hop`); hitchhike target must be active (`inactive_song`); sets `current_hop_id`; `hop` visit for hitchhike only
  - `move_to(p_tz text, p_hop_id uuid) returns void` — hop must be in caller's today journey (`bad_hop`); sets `current_hop_id`; no new hop

- [ ] **Step 1: Write failing pgTAP tests.**
  - `journey_day('2026-11-02 03:59+00', 'UTC') = '2026-11-01'`; `04:00` → `'2026-11-02'`; `('2026-11-02 23:30+00','UTC') = '2026-11-02'`; `'Europe/London'` on `2026-07-01 03:30+00` (04:30 BST) → `'2026-07-01'`
  - `journey_day(now(), 'Mars/Base')` raises `invalid_time_zone`
  - `set_dock` twice → one dock row for A on the second song; 2 `dock` visits; song brightness 1 and active
  - `set_ship_colour('#3fbf7f')` → profile and dock both updated
  - `start_journey` → root hop of kind `start`, `current_hop_id` = it; second call raises `journey_exists`
  - `hop` hitchhike from root → new hop with parent root; `current_hop_id` updated; 1 `hop` visit; `jump` adds no visit
  - `move_to(root)` then `hop` → new hop's parent is root (a branch); total hops 3
  - B calling `hop` with A's hop id → `bad_hop`; A calling `move_to` with a hop from A's journey dated yesterday → `bad_hop`
  - `hop` with kind `start` → raises; hitchhike to an inactive song → `inactive_song`
  - non-member calling any RPC → `not_member`
- [ ] **Step 2: Run** `pnpm test:db` → FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm supabase db reset && pnpm test:db` → PASS.
- [ ] **Step 5: Commit** `feat(db): add dock, ship and journey RPCs`

---

### Task 7: Likes, traces, suggestions and inbox

**Files:**
- Create: `supabase/migrations/20261102000400_trace_rpcs.sql`
- Test: `supabase/tests/04_trace_rpcs.test.sql`

**Interfaces:**
- Consumes: `require_member()` (Task 5)
- Produces:
  - `like_dock(p_dock_id uuid) returns uuid` (trace id or null) — inserts like (ignore duplicate), `like` visit; own dock raises `own_dock`; real dock → upsert caller→owner trace (`origin_song_id` = dock's song on insert, `last_exchange_at = now()`, `brightness = 1`) and a `kept_notices` row for the owner; sample dock → like only, returns null
  - `find_trace(p_trace_id uuid) returns uuid` — target's current dock song id or null; not caller's → `bad_trace`; brightness < 0.1 → `trace_faded`
  - `send_suggestion(p_trace_id uuid, p_song_id uuid) returns uuid` — same checks as `find_trace`; ≥ 3 unseen suggestions on this trace → `suggestion_limit`; inserts suggestion; refreshes the trace; upserts and refreshes the reverse trace (target→caller, `origin_song_id = p_song_id` on insert); `suggestion` visit on the song
  - `mark_inbox_seen() returns void` — sets `seen_at` on caller's unseen suggestions and kept notices
  - view `my_traces(id, origin_song_id, origin_title, origin_artist, ship_colour, brightness, last_exchange_at)` — caller's traces with brightness ≥ 0.1; `ship_colour` from target's profile; no target id
  - view `my_inbox(id, kind, song_id, title, artist, ship_colour, reply_trace_id, created_at, seen_at)` — `kind` = `'suggestion'` or `'kept'`; for suggestions `reply_trace_id` = caller's trace to the sender and `ship_colour` = sender's; for kept notices both null

- [ ] **Step 1: Write failing pgTAP tests.** Fixtures: members A, B; B docked at song S1; a sample dock on S2.
  - A `like_dock(B's dock)` → returns trace id; `my_traces` as A has 1 row with B's ship colour; B's `my_inbox` has 1 `kept` row with null `ship_colour`
  - `like_dock` same dock again → still 1 like, 1 trace, `last_exchange_at` refreshed
  - A `like_dock(sample)` → null, like row exists, no new trace
  - A `like_dock(A's own dock)` → `own_dock`
  - `find_trace` → S1; after B `set_dock(S3)` → S3
  - A `send_suggestion(trace, S4)` → B's `my_inbox` has a suggestion with A's ship colour and a non-null `reply_trace_id`; B `send_suggestion(reply_trace_id, S5)` → A's inbox has it
  - 4th unseen suggestion on the same trace → `suggestion_limit`; after B `mark_inbox_seen()`, sending works again
  - trace with `last_exchange_at = now() - 24 days, brightness = 0.09` → absent from `my_traces`; `find_trace` and `send_suggestion` raise `trace_faded`
  - B calling `find_trace` on A's trace → `bad_trace`
  - `my_traces` and `my_inbox` have no column named `target_id`, `holder_id`, `from_id` or `to_id`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the migration.** Views as in Task 5 (owner rights, filtered by `auth.uid()`), select granted to `authenticated`.
- [ ] **Step 4: Run** `pnpm supabase db reset && pnpm test:db` → PASS.
- [ ] **Step 5: Commit** `feat(db): add likes, traces, suggestions and inbox`

---

### Task 8: Brightness

**Files:**
- Create: `supabase/migrations/20261102000500_brightness.sql`
- Test: `supabase/tests/05_brightness.test.sql`

**Interfaces:**
- Produces: `tick_brightness(p_now timestamptz default now()) returns void` (not granted to clients); `pg_cron` job `brightness-tick` at `0 * * * *` running `select public.tick_brightness()`.

- [ ] **Step 1: Write failing pgTAP tests.** Each case uses its own song with only the listed visits; `tick_brightness(T)` with fixed `T`.
  - one `dock` visit at T−360h (15 days) → `≈ 0.03125`, `active`; at T−384h (16 days) → `inactive`
  - one `hop` visit at T−264h (11 days) → active; T−288h (12 days) → inactive
  - one `dock` at T−72h → `0.5 ± 1e-6`
  - three `dock` visits at T → `1` (capped)
  - no visits, real person docked → `1`, active
  - no visits, sample dock only → `0.15`, active
  - no visits, no dock → `0`, inactive
  - visit at T−31 days → deleted after tick
  - trace with `last_exchange_at` T−7 days → `0.5 ± 1e-6`; T−23 days → `≥ 0.1`; T−24 days → `< 0.1`
  - `cron.job` has a row named `brightness-tick` with schedule `0 * * * *`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the migration.** `create extension if not exists pg_cron`. One set-based `update songs` computing `least(1, Σ weight × 0.5^(age_hours / 72))` over visits from the last 30 days, then applying the docked (1) and sample-only (0.15) overrides and setting `status` by the 0.03 threshold; delete old visits; update all trace brightness.
- [ ] **Step 4: Run** `pnpm supabase db reset && pnpm test:db` → PASS.
- [ ] **Step 5: Commit** `feat(db): add hourly brightness tick`

---

### Task 9: Invites and account recovery

**Files:**
- Create: `supabase/functions/_shared/core/recovery.ts`, `supabase/functions/_shared/core/recovery.test.ts`
- Create: `supabase/migrations/20261102000600_invites.sql`
- Create: `supabase/functions/redeem-invite/index.ts`
- Create: `scripts/create-invites.ts`
- Test: `tests/integration/redeem-invite.test.ts`

**Interfaces:**
- Consumes: `SHIP_COLOURS` (Task 3), `is_member()` (Task 5)
- Produces:
  - `encodeRecoveryCode(userId: string, secret: Uint8Array /* 10 bytes */): string` — Crockford base32 of the 16 uuid bytes + 10 secret bytes, grouped in 4s with `-`
  - `decodeRecoveryCode(code: string): { userId: string; secret: string } | null` — ignores case, spaces and hyphens; `secret` returned as the base32 string used as password
  - `recoveryEmail(userId: string): string` = `` `${userId}@users.music-hitchhiking.invalid` ``
  - `generateInviteCode(): string` — 10 Crockford base32 chars from `crypto.getRandomValues`
  - `hashInviteCode(code: string): Promise<string>` — SHA-256 hex of the code uppercased with spaces and hyphens removed
  - SQL `redeem_invite(p_user_id uuid, p_code_hash text) returns boolean` — service-role only; in one statement marks an unexpired, unredeemed invite as redeemed by `p_user_id` (`update … where redeemed_at is null and expires_at > now() returning`), then inserts the profile (`colour_seed` = random hex, `ship_colour = '#e8554e'`); false if no invite matched
  - Edge Function `POST /functions/v1/redeem-invite` body `{ code: string }`, caller's JWT required → `200 { recoveryCode }` or `400 { error: 'invalid_invite' | 'already_member' }`
  - `pnpm tsx scripts/create-invites.ts <count> [--days 30]` prints codes, stores hashes (needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

- [ ] **Step 1: Write failing unit tests** (`recovery.test.ts`): encode/decode round trip; decode accepts lowercase and missing hyphens; decode of garbage → null; `generateInviteCode` is 10 chars of the Crockford alphabet; `hashInviteCode('ab-cd 12')` equals `hashInviteCode('ABCD12')`.
- [ ] **Step 2: Run** `pnpm test` → FAIL; implement `recovery.ts`; run → PASS.
- [ ] **Step 3: Write failing integration tests** (start stack with `pnpm supabase start` and `pnpm supabase functions serve` in the background; tests create invites through the service key).
  - anonymous sign-in, redeem valid code → 200 with a recovery code; `active_stars` query now succeeds as a member; profile exists
  - same code again from a second anonymous user → 400 `invalid_invite`
  - expired code → 400 `invalid_invite`
  - two anonymous users redeem one code concurrently (`Promise.all`) → exactly one 200
  - member redeeming a second code → 400 `already_member`
  - fresh client: `decodeRecoveryCode` → `signInWithPassword({ email: recoveryEmail(userId), password: secret })` → same `user.id`
  - anonymous user who never redeemed → `active_stars` returns `[]`
- [ ] **Step 4: Run** `pnpm test:integration` → FAIL.
- [ ] **Step 5: Implement** the migration, the function (verify caller with `auth.getUser`, hash code, call `redeem_invite` with service role, then `auth.admin.updateUserById(uid, { email: recoveryEmail(uid), password: secret, email_confirm: true })`, return the encoded code; if the admin update fails, delete the profile and un-redeem the invite before returning 500), and the script.
- [ ] **Step 6: Run** `pnpm test:integration` → PASS; also `pnpm test && pnpm test:db` → PASS.
- [ ] **Step 7: Commit** `feat: add invites and account recovery`

---

## Done when

`pnpm test`, `pnpm test:db` and `pnpm test:integration` all pass on a fresh `pnpm supabase db reset`.
