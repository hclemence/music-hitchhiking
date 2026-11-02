# Music Hitchhiking — Design Spec

Date: 2026-11-02
Source brief: "Music Hitchhiking Build Brief" (Claude Docs)
Status: draft for review

## 1. Summary

A living, unlabelled 3D music map for phones. Every song is a star. Each person is a ship docked at a song they chose. From where you are, you see three nearby docked ships; you can like a song, hitchhike to it, or wait for others. Stars glow with recent activity and fade when nobody visits. Liking someone's dock leaves a private, fading trace that lets you find them again and send songs back and forth. Your day's route is drawn as a small mini-map tree.

First version audience: a small invited group (tens of people), plus clearly labelled sample docks so the map is never empty.

## 2. Principles

- **Encounters, not relationships.** No follows, feeds, profiles or public counts. The only lasting link between two people is a trace, and it fades unless they keep exchanging songs.
- **Identity is a ship.** No name, face or bio. In v1 every ship is the same model; its colour is the only thing a person chooses. A person's ship is visible to everyone. Accepted: a ship carries no personal information.
- **Exploration over labels.** No genre names or text labels on the map. Colour is arbitrary, unique to each viewer, and only shows boundaries between areas.
- **The map shows life.** Stars brighten with activity and disappear when inactive; their positions are kept so returning songs reappear in the same place.
- **A private record.** Your path and traces are visible only to you. Hops never record who took you there.

## 3. Scope

### Included in v1

- Invite-only anonymous accounts, with a one-time recovery code.
- Ship colour picker (one ship model).
- Search any song (MusicBrainz) and dock at it; songs not yet on the map are added and positioned.
- Explore screen: 3D map, three encounters, Like / Hitchhike / Wait, Home, open song on Spotify / Apple Music / YouTube.
- Back and forth along today's path; branching from an earlier hop.
- Mini-map of today's path (tap to enlarge, tap a node to jump).
- Star brightness, fading and inactivity.
- Traces: history of liked docks, Find (fly to their current dock), Send a song, inbox with Visit and Reply.
- Sample docks, visibly labelled.

### Left out of v1

- In-app audio playback (songs open in an external service).
- Live listening / real-time presence; Last.fm-linked docks.
- Ship parts other than colour.
- Sharing trees; browsing past days' trees.
- Native apps; desktop-specific layout (desktop works but is not optimised).
- 2D fallback for devices without WebGL2.

## 4. Architecture

```
 Phone (React + Vite + React Three Fiber, PWA)
   │  reads active_stars, public_docks; writes hops/likes/docks via RPC
   ▼
 Supabase
   ├─ Postgres + Row Level Security
   ├─ Anonymous auth
   ├─ Realtime (ingest job status)
   └─ Edge Functions
        ├─ redeem-invite
        ├─ songs          (search, add, ingest worker)
        └─ brightness-tick (hourly cron; nightly radius refresh)
             │
             ▼
        SimilaritySource interface ── Last.fm implementation
        MusicBrainz client (rate-limited queue)

 Offline seed script (Python) → writes skeleton songs, neighbours, regions, sample docks
```

- **Client** loads active stars and docks, renders the map, computes encounters locally via `findEncounters`, and writes actions through Postgres RPCs.
- **`SimilaritySource`** is the only way any code gets similarity data. v1 implementation: Last.fm `track.getSimilar`. Swappable without touching map or encounter code.
- Encounter logic is a pure function so it can move server-side later (e.g. for a public launch).

## 5. Data model

| Table | Key fields | Notes |
|---|---|---|
| songs | id, mbid (unique), title, artist, x, y, z, region_id, local_radius, spotify_url, apple_url, youtube_url, brightness, status (`active`/`inactive`), origin (`seed`/`ingest`), created_at | Position is set once and never moves |
| song_neighbours | song_id, neighbour_id, weight | Similarity edges needed for placement only |
| visits | id, song_id, kind (`dock`/`like`/`suggestion`/`hop`/`start`), created_at | No user_id. Feeds brightness. Pruned after 30 days |
| profiles | user_id, home_song_id, colour_seed, ship_colour, recovery_hash, created_at | One per anonymous person |
| invites | id, code_hash, created_at, expires_at, redeemed_by, redeemed_at | Single use |
| docks | id, user_id (null for samples), song_id, is_sample, ship_colour, updated_at | At most one dock per real person |
| journeys | id, user_id, day, start_song_id, current_hop_id | `day` = local date with a 4am cutoff |
| hops | id, journey_id, parent_hop_id, song_id, kind (`start`/`hitchhike`/`jump`), created_at | Tree of the day. Never stores who took you there |
| likes | id, user_id, song_id, created_at | Private Likes list |
| traces | id, holder_id, target_id, origin_song_id, created_at, last_exchange_at, brightness | Fades; hidden below 0.1 |
| suggestions | id, trace_id, from_id, to_id, song_id, created_at, seen_at | Visible to sender and receiver only |
| kept_notices | id, owner_id, song_id, created_at, seen_at | "Someone kept your song". No liker stored |
| ingest_jobs | id, mbid, requested_by, status (`queued`/`running`/`done`/`failed`), attempts, error, song_id, created_at | Drives "placing your song…" |
| search_cache | query, results (jsonb), fetched_at | MusicBrainz search results, 24h TTL |

### Read access

- `active_stars` view: songs with `status = active` — id, title, artist, x, y, z, region_id, local_radius, brightness, links. Readable by any signed-in user.
- `public_docks` view: dock id, song_id, is_sample, ship_colour, updated_at. **No user_id.** Readable by any signed-in user.
- All other tables: row-level security restricts each row to its owner (`journeys`, `hops`, `likes`, `profiles`, `traces` by holder, `kept_notices` by owner); `suggestions` to `from_id` or `to_id`. `visits`, `invites`, `song_neighbours`, `ingest_jobs` (except own job status), `search_cache` are not readable by clients.

### RPCs (security definer, so the client never sees another user's id)

- `set_dock(song_id)` — upserts the caller's dock, records a `dock` visit.
- `like_dock(dock_id)` — inserts a like; if the dock is a real person's and not the caller's, creates or refreshes the caller's trace to them and inserts a `kept_notice` for them. Liking a sample dock only adds a like.
- `hop(song_id, parent_hop_id, kind)` — inserts a hop, sets `current_hop_id`, records a `hop` visit for `hitchhike` and a `start` visit for `start`. `jump` (Home, Find, Visit from inbox) records nothing extra.
- `move_to(hop_id)` — going back or forward: only sets `current_hop_id` to an existing hop in today's journey. No new hop.
- `find_trace(trace_id)` — returns the target's current dock song id, or null if they have no dock.
- `send_suggestion(trace_id, song_id)` — inserts a suggestion, refreshes the trace, creates the receiver's reverse trace if missing (or refreshes it), records a `suggestion` visit on the song. Limit: at most 3 unseen suggestions per trace direction.

## 6. Seeding (offline script)

1. Collect candidate tracks: Last.fm `tag.getTopTracks` across ~100 tags (tags used only for seeding, never stored or shown) plus `track.getSimilar` expansion until 5,000–10,000 tracks with MusicBrainz IDs.
2. Build a similarity graph from `track.getSimilar` weights; store edges in `song_neighbours`.
3. Compute a 3D layout from the graph (UMAP on the precomputed graph; force-directed layout as fallback), normalised to a sphere of radius 1000.
4. Cluster positions into ~40 regions with k-means; store centroids and `region_id`.
5. Compute `local_radius` = distance to 30th nearest positioned song.
6. Fill streaming links (Section 7).
7. All seed songs are `inactive` except those with sample docks.
8. Create ~1,500 sample docks on seed songs chosen by farthest-point sampling for even coverage; each gets a random ship colour.
9. Run the quality checks (Section 12) and print a report.

## 7. Adding songs (ingest)

1. **Search.** `songs?q=` queries MusicBrainz recordings (cached 24h) and marks results already stored.
2. **Pick a stored song.** Relit immediately (a `dock` visit sets brightness to 1); position unchanged.
3. **Pick a new song.** Creates an `ingest_jobs` row and returns its id. Client shows "placing your song…" and subscribes via Realtime.
4. **Worker.**
   - Fetch up to 50 similar tracks via `SimilaritySource`; resolve to MusicBrainz IDs (Last.fm mbid where given, otherwise MusicBrainz lookup by artist + title; unresolved are dropped).
   - Position = similarity-weighted mean of neighbours that already have positions, plus random offset of up to 10% of their mean `local_radius`.
   - Neighbours without positions are inserted as `inactive` songs placed around the new song at distance scaled by `(1 − weight) × local_radius`.
   - If no neighbour has a position: place the song at a random point on the outer shell (radius 1100–1200) and cluster its neighbours around it — a new island.
   - Assign `region_id` (nearest centroid), compute `local_radius`, fill links, mark job `done`.
5. **Limits.** MusicBrainz ≤ 1 request/second with the required User-Agent; Last.fm well under its limit. Failed jobs retry up to 3 times with exponential backoff, then `failed`.

**Streaming links.** Use direct Spotify / Apple Music / YouTube URLs from MusicBrainz URL relationships where present; otherwise the service's search URL for "artist title". Every song has all three.

## 8. Brightness

Run hourly by `brightness-tick`.

- Visit weights: dock 1.0, like 0.6, suggestion 0.5, hop 0.4, start 0.3.
- `brightness = min(1, Σ weight × 0.5^(age_hours / 72))` over visits in the last 30 days.
- Overrides: song with a real person docked now → 1. Song with only sample docks → at least 0.15.
- `status = active` if brightness ≥ 0.03, else `inactive`. One dock alone lasts about 15 days after the person leaves; one hop about 11 days.
- Visits older than 30 days are deleted.
- Nightly: recompute `local_radius` for songs whose neighbourhood gained songs that day.

**Traces.** `brightness = 0.5^(days_since_last_exchange / 7)`. An exchange is liking their dock again or a suggestion in either direction. Below 0.1 (~23 days) the trace is hidden from history and Find / Send are disabled.

## 9. Client

### Screens

- **Start** (first run): redeem invite → show recovery code once (with warning that it can't be recovered without it) → pick ship colour → search and choose dock song (also becomes home) → enter map.
- **Explore** (main): 3D map with your ship at the current star and three encounter ships; mini-map (corner); Home button; History drawer; inbox dot.
- **Ship**: colour picker from a curated set of 12 hues, with live preview. Reachable from settings.
- **Dock**: search and change dock song; option "also make this home".

### Explore behaviour

- On open: resume today's journey at `current_hop_id`; otherwise create today's journey at home song (root hop, kind `start`). "Start somewhere else" lets you search a different song for today's root.
- Tap an encounter ship → card with song, artist, ship, three streaming buttons, **Like**, **Hitchhike**. Sample ships render translucent and the card is labelled "Sample".
- Multiple docks at one song → one encounter showing the newest ship and "+N others here". Like targets the shown dock.
- **Hitchhike**: your ship flies alongside theirs to the star (~1.5 s, camera follows); new hop, new encounters.
- **Wait**: three unseen encounters at this hop.
- **Home**: a `jump` hop to the home song. Find (from History) and Visit (from inbox) are also `jump` hops. Jumps are drawn dashed on the mini-map.
- **Mini-map**: today's hop tree. Tap to enlarge; tap a node to move there (`move_to`, no new hop). Hitchhiking or jumping from an earlier node creates a branch.
- **History**: traces with ship, origin song, brightness. **Find** flies to their current dock. **Send a song** opens search.
- **Inbox**: suggestions (Visit, Reply) and kept notices.

### Encounter logic — `findEncounters(position, stars, docks, seen)`

1. Candidates: docks on active stars, excluding your own dock, songs on today's path, and docks already shown at this hop.
2. `r` = current star's `local_radius`.
3. Pick 2 from distance < r/2 and 1 from r/2 ≤ distance ≤ r (random within each band).
4. If either band is short, multiply r by 1.5 and repeat (max 6 widenings; then take nearest available).

### Rendering

- Active stars as instanced points; size and glow from brightness. Inactive stars are not loaded.
- Colour: each viewer's `colour_seed` maps each `region_id` to a colour from a generated palette; adjacent regions guaranteed distinct. No text labels.
- Ships: one low-poly model, tinted by `ship_colour`.
- Target: 60 fps on a mid-range phone with 10k active stars. Device pixel ratio capped at 2; light bloom; automatic lower-detail mode if frame time exceeds budget.
- Controls: drag to orbit current star, pinch to zoom, double-tap a star to focus.

### Data refresh

Reload `active_stars` and `public_docks` on app open, on returning to foreground, and every 5 minutes. User actions update the UI immediately and reconcile on next reload.

## 10. Day boundary

A journey's `day` is the local date, with days running 4:00 to 4:00. Listening past midnight stays in the same tree. Only today's tree is shown; past journeys are stored but not displayed in v1.

## 11. Error handling

| Situation | Behaviour |
|---|---|
| Network drop while exploring | Actions apply instantly, queue on device, retry with backoff; "offline" banner. Encounters keep working from cached data |
| Song can't be placed | 3 retries, then "Couldn't add that song right now — try again or pick another". Existing dock unchanged |
| MusicBrainz / Last.fm down | Search falls back to stored songs ("search limited"); new songs wait in queue |
| Invalid / used / expired invite | Single clear message; nothing created |
| Lost device, no recovery code | Account unrecoverable; stated clearly at setup |
| No WebGL2 | Static message asking for a newer browser |
| Brightness tick fails | Last values remain until next run |
| Trace has faded | Find / Send disabled with "This trace has faded" |
| Too many unseen suggestions on a trace | Send disabled until the receiver sees one |

## 12. Testing

- **Unit (Vitest):** `findEncounters` (exclusions, 2-near/1-far split, widening), brightness formula and overrides, trace decay, placement math, 4am day boundary, region colour mapping (adjacent regions distinct).
- **Access rules:** against local Supabase as two users — no user id in `public_docks`; traces, suggestions, kept notices, journeys, hops, likes isolated; RPCs reject acting on others' data; suggestion limit enforced.
- **Ingest worker integration:** stub `SimilaritySource` and MusicBrainz — normal song, niche song forming an island, retry then failure, already-stored song, rate limiting respected.
- **End-to-end (Playwright, phone viewport):** invite → colour → dock → hitchhike ×3 → back → branch → like → trace appears → send song → second user receives, replies → first user sees reply.
- **Seed quality report:** similar pairs closer than random pairs; random 10-hop walks end far from start; every active star has ≥3 encounter candidates within 6 widenings; manual listening-check guide.
- **Performance:** scripted fly-through with 10k active stars in Chromium logging frame times; manual check on one mid-range Android and one iPhone.

**Ready when:** wandering feels good on its own — each hitchhike sounds like a natural step and several hops reach somewhere clearly different.

## 13. Decisions and accepted risks

- Dock source is user-chosen only in v1 (`source` can expand later).
- Starting song sets where you explore; dock changes only when you change it.
- Ships are public identities; accepted because they carry no personal information. In a small group, a niche dock song plus a ship colour may still let friends recognise each other — accepted for v1.
- Song positions never move; occasional imperfect placement accepted for stability.
- Last.fm data is used under its non-commercial terms; MusicBrainz under its non-commercial use. A commercial launch needs plans for both.

## 14. Open questions (not blocking v1)

- Long-term source for similarity and listening data (replace Last.fm behind `SimilaritySource`).
- When to retire sample docks as the group grows.
- Ship parts beyond colour.
- Whether past days' trees should become viewable.
