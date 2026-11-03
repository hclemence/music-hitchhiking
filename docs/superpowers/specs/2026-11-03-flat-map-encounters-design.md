# Flat Map, Encounters and Shuttle — Design Spec

Date: 2026-11-03
Builds on: `2026-11-02-music-hitchhiking-design.md` (the main spec) and Plan 3's app (`feat/client`).
Status: draft for review

This spec changes how the map looks and how encounters happen. Where it conflicts with the main spec, this spec wins. Mockups: https://claude.ai/artifact/Ria3AfskkotCU2gpH5fzvu (sky "Nebula wash" and the final shuttle).

## 1. What changes and why

| Area | Before | After |
|---|---|---|
| Map | 3D star field you orbit | Flat 2D map seen at a ~35° tilt, with 3D ships |
| Stars | Coloured by area | All white; size and glow from brightness |
| Area colour | On the stars | In the sky: a drifting nebula wash, unique per viewer |
| Encounters | Three cards at once (2 near, 1 further) | One at a time, closest first, revealed with a pop-up |
| Other ships | Only the three encounters | Every docked ship visible, idling around its star |
| Route | Corner mini-map only | Trail on the map plus the corner mini-map |
| Ship model | Small arrow-like model | Boxy, tubby shuttle with under-wing turbines and a white outline |

Why: encounters should feel like an event; 3D added navigation cost on a phone without helping you judge what's near; a flat map shows your route as a drawing in the sky.

Principles kept from the main spec: no labels; colours unique per viewer and marking areas only; identity is a ship colour; nobody's real route is ever shown to others.

## 2. Map

- **Positions are 2D.** Each song has `x, y` on a plane. The `songs.z` column stays and is stored as `0`. Distances everywhere are 2D Euclidean.
- **Sample map** is regenerated in 2D: 12 cluster centres on a disc of radius 600 (minimum separation as now), songs placed within radius 140 of their centre. Same seed scheme, same song ids, regions = cluster centres with 2D adjacency (4 nearest, symmetrised). `local_radius` recomputed in 2D.
- **Plan 2 (real catalogue)** produces a 2D layout (UMAP or force layout to 2D) instead of 3D; placement of new songs uses 2D vectors. Island placement uses a ring (radius 1100–1200) instead of a shell.
- **Camera:** perspective, looking down at the plane from ~35° above horizontal, behind and above your ship. Drag pans, pinch zooms (map units on screen from roughly 150 to 2000 wide), double-tap a star centres on it (no hop). The camera follows your ship during a flight.
- **Flights** arc above the plane (peak height 10% of the hop length, minimum 8 units) over 1.5 s with ease-in-out.

## 3. Sky

- One full-screen fragment shader drawn on the plane (it tilts with the map) behind stars and ships.
- **Colour field:** each region contributes its viewer colour from `regionPalette(colourSeed, …)` (existing core function); colours blend by inverse distance to region centres (power 3) with a slow domain warp (fbm noise) so clouds drift. Region centres stay fixed; only the warp and noise animate.
- **Grade:** colours are desaturated toward their luminance by up to 15%, then clamped so every channel stays within 0.17–0.64. No pixel is black, and white stars keep a contrast ratio of at least 2.5:1 against any sky pixel (a grey of 0.64 gives about 2.5:1; the star glow adds more).
- **Motion** is slow (a full drift cycle takes minutes) and is reduced to a quarter speed under `prefers-reduced-motion`.
- The palette used for the sky must keep neighbouring regions distinct (existing guarantee of `regionPalette`).

## 4. Stars

- White points on the plane, drawn in one pass. Size `2 + 6 × brightness` px at the default zoom (scaled with zoom, clamped 3–24 px), with a soft round glow; brightness also sets glow strength.
- Inactive stars are not drawn (unchanged).
- Visited stars on today's route get a faint ring.

## 5. Ships

- **Every docked ship is visible:** one shuttle per dock from `public_docks`, in that dock's colour, parked beside its star.
- **Ambient motion is decoration only:** each ship idles with a slow loop (radius ~3 units) and a gentle bob; every 20–60 s (seeded by dock id) it drifts out up to ~15 units and returns. Nothing reflects anyone's real route.
- **Your ship** is ~20% larger and has a soft halo.
- **Sample ships** use the same model at 50% opacity.
- **Several docks at one star** fan out around it (up to 5 drawn; the newest first).
- **Level of detail:** the nearest ~150 ships animate with the full model; farther ships use a simplified model (box body + wings) and stay still; ships off-screen are not drawn.

## 6. Shuttle model

- Matches the mockup: one continuous fuselage lofted from a rounded-box profile (0.84 × 0.72, corner radius 0.22, length ~2.2) tapering into the nose; a cockpit window on the upper nose; a chunky tail fin; thick swept wings with slight dihedral; under each wing a short pylon and a turbine that is a plain cylinder with rounded ends and a small glow disc at the back.
- **No cone or pyramid plume** behind the main thruster or the turbines; engines show only flat glow discs.
- **One colour:** every part in the ship colour, except the cockpit glass and the engine glow discs. Flat shading.
- **White outline** around the silhouette at a constant ~2 px on screen, independent of ship size (inverted hull extruded along smoothed normals in clip space, or an equivalent technique). No visible seams where parts join.
- **Size on screen:** about 24 px long at the default zoom, never below 14 px.
- The same model is used on the map, in the Ship picker preview, in the encounter pop-up and in History rows (as a small rendered thumbnail or the live model).

## 7. Encounters

**Order.** Candidates are docks on active stars, excluding: your own dock, songs on today's route, the current star, and docks already met at this stop. Docks at the same song form one candidate (newest dock shown, "+N others here"). Candidates are ordered by 2D distance from your current star, nearest first, with no distance cap. Ties break by dock id.

**Core function** (replaces `findEncounters` for the app): `nextEncounter({ current, stars, docks, ownDockId, pathSongIds, metDockIds }) → Encounter | null`, pure and deterministic.

**On arrival** (after a hitchhike, jump, start, or move to a visited star):
1. ~1.5 s after the flight ends, compute `nextEncounter`.
2. The encountered ship leaves its star and flies to a parking spot beside your ship (1.2 s arc).
3. A bottom pop-up slides up: "You've encountered someone", with the ship colour (model thumbnail), song title, artist, a "Sample" badge if a sample, "+N others here" if any, Listen buttons (Spotify, Apple Music, YouTube), **Like**, **Hitchhike**, and a close control.
4. Closing the pop-up leaves the ship parked beside you for the rest of this stop; tapping it reopens the pop-up.

**Wait:** your ship drifts slightly, then the next `nextEncounter` (with the previous one added to `metDockIds`) is revealed the same way. Ships already met at this stop stay parked beside you (up to 4 parked; older ones return to their stars).

**Nobody left:** if `nextEncounter` returns null, the pop-up reads "Nobody else nearby — try Home or hitchhike from here".

**Unchanged:** Like (trace + kept notice), Hitchhike (optimistic hop, retry, bad_hop recovery), Find, Visit, History, Inbox; ships docked at your current star still open the "Docked here" card.

**Removed:** the three-card encounter strip and the "2 near + 1 further" rule.

## 8. Route

- A faint glowing trail on the map connects today's hops (parent → child), with branches; jump hops are dashed.
- Visited stars get a faint ring; tapping one calls `move_to` (no new hop), as the mini-map does.
- The corner mini-map stays, unchanged in behaviour.

## 9. Performance

- Target: 60 fps on a mid-range phone with ~10k stars and ~200 ships.
- Draw calls: sky 1, stars 1, trail 1, ships instanced (full model) + instanced (simple model), outlines with their ship pass.
- No per-frame allocations in animation loops; buffers rebuilt only when stars, docks or the route change.
- A quality fallback halves the sky shader resolution and drops ambient drift when the average frame time exceeds 22 ms for 3 s.

## 10. Testing

- **Core:** `nextEncounter` ordering, exclusions, grouping, tie-break, null; 2D placement and sample map invariants (2D adjacency, regionId = cluster, z = 0).
- **App unit:** encounter flow (arrival → reveal after delay; Wait → next; met ships parked; pop-up close/reopen; nobody-left text) with fake timers and a stubbed scene; route trail data (edges, dashed jumps); tap visited star → `moveTo`.
- **Pure render helpers:** sky colour grading keeps every channel in range and star contrast ≥ 2.5:1 for all 12-colour palettes; ship LOD selection; ambient motion is deterministic per dock id.
- **E2E:** demo offline check still passes; the live two-person flow is updated for one-at-a-time encounters (B waits until A's ship is revealed).
- **Visual check:** screenshots at 390 × 844 of the map, an encounter pop-up, the trail, and the Ship picker.

## 11. Out of scope

Real-time movement of real people's ships; showing recent real hops as light streaks; in-app audio; ship parts other than colour.
