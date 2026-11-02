import type { Encounter, PublicDock, Star } from './types.ts';
import { distance } from './vec.ts';

const MAX_WIDENINGS = 6;
const WIDEN_FACTOR = 1.5;

export function findEncounters(args: {
  current: Star;
  stars: ReadonlyMap<string, Star>;
  docks: readonly PublicDock[];
  ownDockId: string | null;
  pathSongIds: ReadonlySet<string>;
  seenDockIds: ReadonlySet<string>;
  rng: () => number;
}): Encounter[] {
  const { current, stars, docks, ownDockId, pathSongIds, seenDockIds, rng } = args;

  // Group eligible docks per song; the newest is shown, the rest are counted.
  const bySong = new Map<string, { newest: PublicDock; newestAt: number; count: number }>();
  for (const dock of docks) {
    if (dock.id === ownDockId || seenDockIds.has(dock.id)) continue;
    if (dock.songId === current.id || pathSongIds.has(dock.songId)) continue;
    if (!stars.has(dock.songId)) continue;
    const at = Date.parse(dock.updatedAt);
    const group = bySong.get(dock.songId);
    if (!group) {
      bySong.set(dock.songId, { newest: dock, newestAt: at, count: 1 });
    } else {
      group.count++;
      if (at > group.newestAt) {
        group.newest = dock;
        group.newestAt = at;
      }
    }
  }

  const candidates: Encounter[] = [];
  for (const [songId, group] of bySong) {
    candidates.push({
      songId,
      dock: group.newest,
      othersCount: group.count - 1,
      distance: distance(current, stars.get(songId)!),
    });
  }

  let r = current.localRadius;
  for (let widening = 0; widening <= MAX_WIDENINGS; widening++) {
    const near = candidates.filter((c) => c.distance < r / 2);
    const far = candidates.filter((c) => c.distance >= r / 2 && c.distance <= r);
    if (near.length >= 2 && far.length >= 1) {
      shuffle(near, rng);
      shuffle(far, rng);
      return [near[0], near[1], far[0]];
    }
    r *= WIDEN_FACTOR;
  }

  return candidates.sort((a, b) => a.distance - b.distance).slice(0, 3);
}

/** In-place Fisher-Yates shuffle. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
