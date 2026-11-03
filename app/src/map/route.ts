import type { Hop } from '../backend/types.ts';

export type Pt = { x: number; y: number };
export type RouteSegment = { from: Pt; to: Pt; dashed: boolean; toHopId: string };

/** One segment per hop with a parent (parent song to this hop's song); jumps are dashed. Unknown positions are skipped. */
export function routeSegments(hops: Hop[], position: (songId: string) => Pt | undefined | null): RouteSegment[] {
  const byId = new Map<string, Hop>();
  for (const h of hops) byId.set(h.id, h);
  const out: RouteSegment[] = [];
  for (const h of hops) {
    if (!h.parentHopId) continue;
    const parent = byId.get(h.parentHopId);
    if (!parent) continue;
    const from = position(parent.songId), to = position(h.songId);
    if (!from || !to) continue;
    out.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, dashed: h.kind === 'jump', toHopId: h.id });
  }
  return out;
}

/** The most recent hop at a song (by creation time, later list position on ties), or null. */
export function latestHopAtSong(hops: Hop[], songId: string): string | null {
  let best: Hop | null = null;
  let bestT = -Infinity;
  for (const h of hops) {
    if (h.songId !== songId) continue;
    const t = Date.parse(h.createdAt) || 0;
    if (t >= bestT) { best = h; bestT = t; }
  }
  return best ? best.id : null;
}

export type TapAction = { kind: 'ship' } | { kind: 'visited'; songId: string } | null;

/** Tap priority: a ship under the finger wins over a visited star, which wins over nothing. */
export function resolveTap(shipHit: boolean, visitedSongId: string | null): TapAction {
  if (shipHit) return { kind: 'ship' };
  return visitedSongId ? { kind: 'visited', songId: visitedSongId } : null;
}
