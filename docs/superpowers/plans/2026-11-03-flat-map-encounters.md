# Music Hitchhiking — Plan 4: Flat Map, Encounters and Shuttle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3D star field with a flat tilted map (white stars over a per-viewer nebula sky, every docked shuttle visible and idling, your route as a trail), introduce one-at-a-time closest-first encounters with a pop-up, and replace the ship with the boxy outlined shuttle.

**Architecture:** Pure, tested helpers (core `nextEncounter`, 2D placement, sky grading, shuttle geometry, ambient motion, ship LOD, flight arc, route segments, encounter-flow reducer) feed thin React Three Fiber components. `useExplore` swaps its three-card encounter state for an encounter-flow state machine; `Explore` swaps `EncounterBar` for `EncounterPopup`. The sample map is regenerated in 2D.

**Tech Stack:** existing app stack (React 19, Vite, three 0.187, @react-three/fiber 9, @react-three/drei 10, Vitest + RTL, Playwright). `three/examples/jsm/utils/BufferGeometryUtils.js` for merging.

**Spec:** `docs/superpowers/specs/2026-11-03-flat-map-encounters-design.md` (wins over the main spec where they differ). Branch: `feat/flat-map` (off `feat/client`).

## Global Constraints

- Map plane: song `(x, y)` → world `(x, 0, y)`; Y is up. Distances are 2D Euclidean on `(x, y)`; `z` is ignored and stored as `0`.
- Camera pitch 35° above horizontal; visible map width from 150 to 2000 units; flights 1500 ms ease-in-out on an arc with peak height `max(8, 0.1 × hop length)`.
- Sky: inverse-distance blend (power 3) of region colours from `regionPalette`, slow fbm warp; grade = desaturate toward luminance by 15%, then clamp every channel to 0.17–0.64; white stars ≥ 2.5:1 contrast against any sky pixel; reduced motion → quarter speed.
- Stars white; point size `2 + 6 × brightness` px at default zoom, clamped 3–24 px; visited stars get a faint ring.
- Ships: every dock in `public_docks` drawn; idle loop radius ~3 units, bob, drift out up to ~15 units every 20–60 s seeded by dock id; your ship ~20% larger with a halo; samples at 50% opacity; up to 5 docks fanned out per star, newest first; nearest ~150 ships full model and animated, others simple model and still, off-screen culled.
- Shuttle: one-colour fuselage lofted from rounded box 0.84 × 0.72 (corner 0.22) into a tapered nose, cockpit window, tail fin, thick swept wings with slight dihedral, under-wing pylon + rounded-cylinder turbine; glow discs only (no cone/pyramid plume); white outline ~2 px constant on screen; ~24 px long on screen at default zoom, never < 14 px.
- Encounters: candidates = docks on active stars, minus own dock, today's route songs, current star, and docks met at this stop; same-song docks grouped (newest shown, "+N others here"); ordered by 2D distance, no cap, ties by dock id. Reveal 1500 ms after arrival; encountered ship flies to you in 1200 ms; up to 4 parked at your stop.
- Copy: pop-up title "You've encountered someone"; none left: "Nobody else nearby — try Home or hitchhike from here".
- Performance: 60 fps target with ~10k stars and ~200 ships; no per-frame allocations; quality fallback at average frame time > 22 ms for 3 s (half-resolution sky, no ambient drift).
- Never show or store another person's user id (unchanged).

## Review Focus

1. The phone is backgrounded (or the tab hidden) during the 1500 ms arrival pause or the fly-in → on return the reveal still happens once, not zero or twice. (Task 8)
2. Hitchhike, Home or a route tap during a pending reveal → the old stop's reveal never appears at the new stop. (Task 8)
3. More than 4 people met at one stop via Wait → only the 4 most recent stay parked; tapping a parked ship reopens its pop-up; older ones return to their stars. (Task 8)
4. Region data the sky can't use (more than 64 regions, or ids missing from `regions`) → the sky still draws, extras ignored and unknown areas neutral; no crash. (Task 3)
5. A route that includes songs not in `active_stars` (faded, reached via Home/Find) → the trail still draws those segments using positions from `getSongs`. (Task 7)

---

## File Structure

```
supabase/functions/_shared/core/encounters.ts   + nextEncounter (findEncounters kept, unused by app)
supabase/functions/_shared/core/placement.ts    + planar option for placeSong / placeAround
supabase/functions/_shared/core/vec.ts          + randomUnitVector2D
scripts/sample-map.ts, data/sample-map.json     2D layout
app/src/map/sky.ts            grading, contrast, uniforms (pure)
app/src/map/Sky.tsx           nebula plane (shader)
app/src/map/shuttle.ts        shuttle + simple geometry, outline material, screen sizing (pure-ish, three only)
app/src/map/Shuttle.tsx       instanced/single shuttle component
app/src/map/motion.ts         arcPoint, ambientOffset, selectShipLod, parkingSlot, createQualityMonitor (pure)
app/src/map/route.ts          routeSegments (pure)
app/src/map/MapScene.tsx      rewritten flat scene composing Sky, Stars, Ships, Route
app/src/map/Stars.tsx, stars.ts   white stars, visited rings
app/src/map/Ships.tsx         all docks, LOD, ambient, parked and arriving ships
app/src/map/Route.tsx         trail + visited rings + tap targets
app/src/state/encounterFlow.ts   encounter state machine (pure)
app/src/state/useExplore.ts   uses encounterFlow + nextEncounter
app/src/ui/EncounterPopup.tsx replaces EncounterBar (EncounterCard reused inside)
app/src/ui/ShipPicker.tsx     preview uses Shuttle
```

Remove: `app/src/map/ShipModel.tsx`, `app/src/map/Flight.tsx` (folded into Ships), `app/src/ui/EncounterBar.tsx`, 3D-only helpers in `controls.ts` (`shipScale`, `dockedPosition`, `DOCK_SLOTS`) once unused.

---

### Task 1: `nextEncounter`

**Files:** Modify `supabase/functions/_shared/core/encounters.ts`; Test `supabase/functions/_shared/core/encounters.test.ts`.

**Interfaces:**
- Produces: `nextEncounter(args: { current: Star; stars: ReadonlyMap<string, Star>; docks: readonly PublicDock[]; ownDockId: string | null; pathSongIds: ReadonlySet<string>; metDockIds: ReadonlySet<string> }): Encounter | null` — `Encounter.distance` is the 2D distance.

- [ ] **Step 1: Failing tests** (`describe('nextEncounter')`): returns the nearest by 2D distance (a star with large `z` but small `(x,y)` distance wins); excludes own dock, current song, path songs, met docks, songs not in `stars`; groups same-song docks (newest by `updatedAt` shown, `othersCount` = rest); a group whose newest dock is met still offers its next-newest unmet dock; ties broken by smaller dock id; returns `null` when nothing is left; calling repeatedly while adding each result's `dock.id` to `metDockIds` yields every eligible song exactly once in distance order.
- [ ] **Step 2:** `pnpm test` → FAIL. **Step 3:** implement (reuse the grouping logic from `findEncounters`, extracted to a shared private helper). **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(core): add nextEncounter`

---

### Task 2: 2D placement and sample map

**Files:** Modify `core/vec.ts`, `core/placement.ts`, their tests; `scripts/sample-map.ts`, `scripts/sample-map.test.ts`; regenerate `data/sample-map.json`.

**Interfaces:**
- Produces: `randomUnitVector2D(rng): Vec3` (z = 0); `placeSong(neighbours, rng, opts?: { planar?: boolean })` and `placeAround(anchor, weight, localRadius, rng, opts?: { planar?: boolean })` — planar results have `z === 0`; planar islands lie on a ring of radius 1100–1200.
- `buildSampleMap(input, seed)` now returns songs and regions with `z === 0`: 12 centres on a disc of radius 600 (same minimum-separation relaxation), songs within radius 140 of their centre (`sqrt(rng())` radial distribution), regions = centres, adjacency = 4 nearest symmetrised, `localRadius` via `computeLocalRadius` in 2D. Song ids, URLs and dock rules unchanged.

- [ ] **Step 1: Failing tests:** planar `placeSong`/`placeAround` keep `z = 0` and satisfy the existing distance rules in 2D; planar island radius ∈ [1100, 1200]; sample map: every `z === 0`; every song within 140 of its region centre; `regionId === input cluster` for every song; adjacency symmetric; deterministic.
- [ ] **Step 2–4:** FAIL → implement → PASS. Run `pnpm tsx scripts/build-sample-map.ts` and commit the new JSON.
- [ ] **Step 5:** If the local stack is up, `pnpm db:reset:sandbox && pnpm seed:sample` succeeds (record counts in the report).
- [ ] **Step 6: Commit** `feat: lay out songs on a 2D plane`

---

### Task 3: Sky

**Files:** Create `app/src/map/sky.ts`, `app/src/map/sky.test.ts`, `app/src/map/Sky.tsx`.

**Interfaces:**
- Consumes: core `regionPalette`, `Region`.
- Produces:
  - constants `SKY_MIN = 0.17`, `SKY_MAX = 0.64`, `SKY_DESAT = 0.15`, `MAX_SKY_REGIONS = 64`
  - `gradeSkyColour(rgb: readonly [number, number, number]): [number, number, number]`
  - `contrastWithWhite(rgb: readonly [number, number, number]): number` (WCAG contrast ratio, sRGB in 0–1)
  - `skyUniforms(colourSeed: string, regions: readonly Region[]): { centres: Float32Array; colours: Float32Array; count: number }` — at most `MAX_SKY_REGIONS`, region order sorted by id, colours already graded, regions with non-finite coordinates skipped
  - `<Sky colourSeed regions quality={'high'|'low'} reducedMotion />` — a plane under the map (world y = −1) large enough to fill the view at max zoom-out, fragment shader with the blend/warp; the shader's grade uses the same constants (interpolated into the GLSL string).

- [ ] **Step 1: Failing tests:** `gradeSkyColour` keeps every channel in [0.17, 0.64] for black, white and saturated inputs; for 200 random colours and every colour from `regionPalette` over 50 seeds × 40 regions, `contrastWithWhite(gradeSkyColour(c)) ≥ 2.5`; `skyUniforms` caps at 64, skips non-finite regions, is deterministic per seed; `contrastWithWhite([0,0,0]) ≈ 21`, `([1,1,1]) ≈ 1`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm app:test`).
- [ ] **Step 5: Commit** `feat(app): add nebula sky`

---

### Task 4: Shuttle model

**Files:** Create `app/src/map/shuttle.ts`, `app/src/map/shuttle.test.ts`, `app/src/map/Shuttle.tsx`, `app/src/ui/ShipBadge.tsx`; Modify `app/src/ui/ShipPicker.tsx` (preview), `app/src/ui/HistoryDrawer.tsx`, `app/src/ui/Inbox.tsx`; Delete `app/src/map/ShipModel.tsx` once unused.

**Interfaces:**
- Produces:
  - `buildShuttle(): { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry; glow: THREE.BufferGeometry; outline: THREE.BufferGeometry }` — merged per material; forward is −Z; normalised so the total length along Z is 1; `outline` is the merged paint + glass silhouette with vertices welded and smooth normals.
  - `buildSimpleShuttle(): { paint: THREE.BufferGeometry; outline: THREE.BufferGeometry }` — box body + two wings, same length.
  - `createOutlineMaterial(widthPx = 2): THREE.ShaderMaterial` — back faces, white, vertices pushed along the screen-projected normal by `widthPx` (constant on-screen width; uniform `uResolution` updated on resize).
  - `shipWorldLength(cameraDistance: number, fovDeg: number, viewportHeightPx: number, opts?: { targetPx?: number; minPx?: number; mine?: boolean }): number` — world length that projects to `targetPx` (default 24) at the given distance, never below `minPx` (default 14); `mine` multiplies by 1.2.
  - `<Shuttle colour opacity={1} lod={'full'|'simple'} mine={false} />` using module-level shared geometries (built once).
  - `shipThumbnail(colour: string, sizePx = 40): Promise<string>` — renders the shuttle once per colour to a data URL with one shared offscreen renderer (cached); `<ShipBadge colour />` shows it as an `<img alt="">`, falling back to the colour dot while loading or without WebGL. Used in History and Inbox rows and the encounter pop-up.
- Model per the spec section 6 and the published mockup (lofted fuselage, cockpit, fin, wings with dihedral, pylons, rounded-cylinder turbines, glow discs). No cones.

- [ ] **Step 1: Failing tests:** `buildShuttle()` geometries are non-empty; paint bounding box Z extent ≈ 1 (±0.01), width (X) between 0.9 and 1.3 of length, height (Y) < 0.6 of length; every `glow` vertex lies within 0.02 of a plane perpendicular to Z (flat discs, no cones); `outline` has fewer vertices than paint+glass (welded) and every vertex normal has length ≈ 1; `createOutlineMaterial()` uses `THREE.BackSide`, white, `uniforms.uWidthPx.value === 2`; `shipWorldLength` projects to 24 px for a typical setup, never below 14 px when the camera is far, and ×1.2 when `mine`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** History and Inbox rows use `<ShipBadge>` instead of the colour dot (their tests still pass with the thumbnail mocked). ShipPicker's live preview renders `<Shuttle>`; its existing tests still pass (mocked canvas). Visual check: screenshot the Ship screen to the scratchpad (`ship-picker.png`) and look: one colour, white outline, no seams at the nose, no plume cones.
- [ ] **Step 6: Commit** `feat(app): add outlined shuttle model`

---

### Task 5: Flat scene foundation

**Files:** Rewrite `app/src/map/MapScene.tsx`; Modify `app/src/map/Stars.tsx`, `app/src/map/stars.ts` (+ tests), `app/src/map/controls.ts` (+ tests); Create `app/src/map/motion.ts`, `app/src/map/motion.test.ts`; Delete `app/src/map/Flight.tsx`.

**Interfaces:**
- Produces (motion.ts):
  - `arcPoint(from: {x:number;y:number}, to: {x:number;y:number}, t: number): { x: number; y: number; h: number }` — eased (existing `easeInOut`), `h = peak × sin(π × eased)`, `peak = max(8, 0.1 × dist)`
  - `createQualityMonitor(opts?: { thresholdMs?: number; windowMs?: number }): { sample(dtMs: number): 'high' | 'low' }` — defaults 22 ms / 3000 ms; goes low when the rolling average over the window exceeds the threshold, back to high when it drops below 0.8 × threshold for a full window
- `buildStarBuffers(stars: Song[], visited: ReadonlySet<string>): { positions; sizes; brightness; ring; indexOf }` — positions on the plane `(x, 0, y)`, all white (no colour buffer), `ring = 1` for visited.
- `MapSceneProps` (final shape; later tasks fill the ships/route props):
  `{ stars: Song[]; regions: Region[]; docks: PublicDock[]; colourSeed: string; currentSongId: string; myDockId: string | null; myShipColour: string; routeHops: Hop[]; extraSongs: ReadonlyMap<string, Song>; parked: ShownEncounter[]; arriving: { dockId: string; startedAt: number } | null; flight: FlightState | null; onFlightEnd?: () => void; onStarDoubleTap?: (songId: string) => void; onShipTap?: (dockId: string) => void; onVisitedTap?: (songId: string) => void }`
- Camera: perspective, fov 50, pitch 35°, drei `MapControls` with rotation disabled, pan by drag, zoom by pinch/scroll, distance limits from the 150–2000 visible-width rule; double-tap focuses a star (no hop, existing gesture helpers); the camera target follows your ship during a flight via `arcPoint`.

- [ ] **Step 1: Failing tests:** `arcPoint` endpoints (`t=0` → from, `t=1` → to, `h=0` at both), peak at `t=0.5` equals `max(8, 0.1×dist)`; quality monitor stays high under 16 ms samples, goes low after 3 s of 30 ms samples, recovers after a window under 17.6 ms; `buildStarBuffers` places stars at `(x, 0, y)`, sizes `2 + 6b`, ring for visited, no colour attribute.
- [ ] **Step 2–4:** FAIL → implement → PASS. Sky draws under the stars; quality low → sky half resolution.
- [ ] **Step 5:** Visual check with the DEV `?scene=1` harness (update it to the new props): screenshot `flat-1.png` at 390×844 — tilted plane, nebula sky, white stars, your shuttle at the current star; look at it.
- [ ] **Step 6: Commit** `feat(app): flat tilted map with sky and white stars`

---

### Task 6: Ships layer

**Files:** Create `app/src/map/Ships.tsx`; Modify `app/src/map/motion.ts` (+ tests), `app/src/map/MapScene.tsx`, `app/src/map/controls.ts` (remove 3D ship helpers).

**Interfaces:**
- Produces (motion.ts):
  - `ambientOffset(dockId: string, tMs: number): { dx: number; dy: number; dh: number }` — loop radius 3, period 6–10 s, bob ±0.6, plus a drift out to ≤ 15 units lasting 4 s that starts every 20–60 s; all phases seeded from the dock id (core `seededRng`)
  - `fanSlot(index: number): { dx: number; dy: number }` — slot 0 is beside the star; up to 5 distinct slots
  - `parkingSlot(index: number): { dx: number; dy: number }` — up to 4 spots beside your ship
  - `selectShipLod(ships: { dockId: string; x: number; y: number }[], view: { x: number; y: number; halfWidth: number; halfHeight: number }, maxFull = 150): { full: string[]; simple: string[] }` — culls outside the view rect (+10% margin), nearest-to-centre `maxFull` get full
- `Ships.tsx`: draws every dock (instanced per LOD and opacity group), your ship (×1.2, halo, at your current star or along the flight arc), parked encounters at `parkingSlot`s beside you, the arriving ship flying from its star to its parking slot over 1200 ms on an `arcPoint`; taps call `onShipTap(dockId)`; no ambient drift when quality is low.

- [ ] **Step 1: Failing tests:** `ambientOffset` deterministic per id, bounded (loop ≤ 3 + bob, drift ≤ 15), differs between ids, and a drift occurs at least once in any 60 s window; `fanSlot`/`parkingSlot` distinct for indices 0..4 / 0..3; `selectShipLod` culls outside the rect, returns at most 150 full sorted by distance, the rest simple.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Visual check `flat-2.png`: many idling ships around stars, samples translucent, your ship larger with a halo; look at it.
- [ ] **Step 6: Commit** `feat(app): show every docked shuttle with ambient motion`

---

### Task 7: Route on the map

**Files:** Create `app/src/map/route.ts`, `app/src/map/route.test.ts`, `app/src/map/Route.tsx`; Modify `MapScene.tsx`.

**Interfaces:**
- Produces: `routeSegments(hops: Hop[], position: (songId: string) => { x: number; y: number } | undefined): { from: { x: number; y: number }; to: { x: number; y: number }; dashed: boolean; toHopId: string }[]` — one segment per hop with a parent, `dashed` when the hop kind is `jump`, skipping segments whose positions are unknown.
- `Route.tsx`: faint glowing lines on the plane (dashed for jumps); visited stars' rings come from Task 5's buffers; tapping a visited star (screen pick within 32 px, reusing `pickNearest`) calls `onVisitedTap(songId)`. `MapScene` resolves positions from `stars` then `extraSongs` (Review Focus 5).

- [ ] **Step 1: Failing tests:** a chain gives n−1 segments; a branch gives two segments from the same parent; jump hops are dashed; a hop whose song is only in `extraSongs` still yields a segment; unknown positions are skipped.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(app): draw today's route on the map`

---

### Task 8: Encounter flow and pop-up

**Files:** Create `app/src/state/encounterFlow.ts`, `app/src/state/encounterFlow.test.ts`, `app/src/ui/EncounterPopup.tsx`; Modify `app/src/state/useExplore.ts`, `app/src/ui/Explore.tsx`, `app/src/ui/explore.test.tsx`, `app/src/app.css`; Delete `app/src/ui/EncounterBar.tsx`.

**Interfaces:**
- Consumes: `nextEncounter` (Task 1), journey `seenDockIds`/`encountersShown` as the met list, MapScene `parked`/`arriving`/`onShipTap` (Tasks 5–6).
- Produces:
  - constants `ARRIVAL_DELAY_MS = 1500`, `FLY_IN_MS = 1200`, `WAIT_DRIFT_MS = 800`, `MAX_PARKED = 4`
  - `EncounterFlowState = { hopId: string | null; phase: 'idle' | 'pending' | 'arriving' | 'shown' | 'none'; dueAt: number | null; current: string | null; parked: string[]; popup: string | null }` (dock ids)
  - `encounterFlowReducer(s, a)` with actions `arrived(hopId, now)` (→ pending, dueAt = now + ARRIVAL_DELAY_MS, clears parked/current/popup), `waitPressed(now)` (→ pending, dueAt = now + WAIT_DRIFT_MS), `revealed(hopId, dockId | null, now)` (ignored when hopId ≠ state.hopId; null → `none`; else → `arriving`, current = dockId, parked = [...parked, dockId].slice(-4), popup = dockId), `flyInDone(dockId)` (→ `shown`), `closePopup()`, `openPopup(dockId)` (only for parked ids)
  - `useExplore` returns `encounter: { phase; current: ShownEncounter | null; parked: ShownEncounter[]; popup: ShownEncounter | null; nobodyLeft: boolean }` and actions `wait()`, `openEncounter(dockId)`, `closeEncounter()`; removes `encounters`, `waitCount` and the `findEncounters` use. The reveal timer is computed from `dueAt` on every tick/visibility change, so a hidden tab reveals once on return (Review Focus 1). A new hop (hitchhike, jump, start, move_to) dispatches `arrived` for the new hop, so late reveals for the old hop are dropped by the hopId check (Review Focus 2).
  - `EncounterPopup` props `{ encounter: ShownEncounter | null; nobodyLeft: boolean; kept: boolean; pending: boolean; onLike; onHitchhike; onClose }` — `role="dialog"`, title "You've encountered someone", ship thumbnail (`<Shuttle>` in a small canvas, mocked in tests) or swatch, song, artist, Sample badge, "+N others here", Listen links, Like, Hitchhike, Close; when `nobodyLeft`: "Nobody else nearby — try Home or hitchhike from here".
  - Ship tap: a parked dock → `openEncounter`; a dock at your current star → existing "Docked here" card; any other ship → nothing.

- [ ] **Step 1: Failing reducer tests:** arrival → pending with dueAt; revealed for a stale hopId is ignored; null → none; parked keeps the last 4; openPopup only for parked; closePopup keeps parked.
- [ ] **Step 2: Failing UI tests** (fake timers, DemoBackend, MapScene stub exposing `parked`/`arriving` and ship buttons): no pop-up before 1500 ms, pop-up after with the nearest sample song; Wait reveals the next-nearest after 800 ms and the first stays parked; closing then tapping the parked ship reopens it; after all candidates are met the nobody-left text appears; hitchhiking during a pending reveal shows the new stop's encounter only (RF2); hiding the document during the pause and showing it after reveals exactly once (RF1); five Waits leave exactly 4 parked (RF3); Like and Hitchhike in the pop-up behave as before (trace, optimistic hop).
- [ ] **Step 3:** FAIL → implement → PASS (`pnpm app:test`, `pnpm exec tsc -p app`).
- [ ] **Step 4:** Visual check `encounter.png` at 390×844 in demo mode: pop-up over the map with the shuttle beside yours; look at it.
- [ ] **Step 5: Commit** `feat(app): one-at-a-time encounters with a pop-up`

---

### Task 9: End-to-end, demo and cleanup

**Files:** Modify `app/e2e/live-flow.spec.ts`, `app/e2e/demo-offline.spec.ts`, `README.md`; remove dead code (`findEncounters` import paths in app, unused controls helpers, DEV harness props).

- [ ] **Step 1:** Live e2e: choose B's start song with `nextEncounter` over the 2D sample map so A's dock is B's first encounter (fallback: press Wait up to 40 times until the pop-up shows A's song); assert the pop-up title, Like → trace, Hitchhike from the pop-up; keep the rest of the two-person flow. Screenshots `e2e2-*.png`.
- [ ] **Step 2:** Demo offline check: reaches the map, waits for the first pop-up, presses Wait once, sees a second encounter; still zero external requests; demo < 16 MB.
- [ ] **Step 3:** Run `pnpm test`, `pnpm app:test`, `pnpm exec tsc -p app`, `pnpm exec tsc -p .`, `pnpm app:build:demo`, `pnpm app:e2e` (stack: `:sandbox` scripts, `seed:sample`, `functions:serve:sandbox`) → all pass; copy the demo to the scratchpad as `music-hitchhiking-demo.html`.
- [ ] **Step 4:** Performance probe: a DEV-only harness with 10,000 random stars and 200 docks; record average frame time over 5 s in headless Chromium (report only; SwiftShader numbers are not a real-GPU result).
- [ ] **Step 5: Commit** `test(app): update e2e and demo for flat map encounters`

## Done when

All suites pass, the demo works offline, and screenshots show: tilted nebula map with white stars, many idling outlined shuttles, a trail with branches, and the encounter pop-up.
