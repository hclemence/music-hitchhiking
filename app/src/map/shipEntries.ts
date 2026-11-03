import { seededRng } from '@core/rng.ts';
import type { PublicDock } from '@core/types.ts';
import type { ShownEncounter } from '../state/useExplore.ts';
import { MAX_FAN } from './motion.ts';

export type Kind = 0 | 1 | 2; // fan | parked | arriving
export type Entry = {
  dockId: string;
  colour: string;
  sample: boolean;
  kind: Kind;
  star: { x: number; y: number };
  fan: number; // slot index at the star
  park: number; // parking slot beside you
  startedAt: number;
  baseYaw: number;
  yaw: number;
  lod: 0 | 1 | 2; // culled | full | simple
  set: number; // index into the instanced sets
  inst: number; // instance index inside the set
};

function makeEntry(dockId: string, colour: string, sample: boolean, kind: Kind, star: { x: number; y: number }): Entry {
  const yaw = seededRng(`heading:${dockId}`)() * Math.PI * 2;
  return { dockId, colour, sample, kind, star, fan: 0, park: 0, startedAt: 0, baseYaw: yaw, yaw, lod: 0, set: 0, inst: 0 };
}

/** Every ship the layer may draw: top docks per star (newest first), parked and arriving encounters. */
export function buildEntries(
  docks: PublicDock[], myDockId: string | null, currentSongId: string, parked: ShownEncounter[],
  arriving: { dockId: string; startedAt: number } | null,
  posOf: (songId: string) => { x: number; y: number } | null,
): Entry[] {
  const away = new Set<string>(parked.map((p) => p.dock.id));
  if (arriving) away.add(arriving.dockId);
  const bySong = new Map<string, PublicDock[]>();
  for (const d of docks) {
    if (d.id === myDockId) continue;
    let a = bySong.get(d.songId);
    if (!a) bySong.set(d.songId, (a = []));
    a.push(d);
  }
  const out: Entry[] = [];
  let arrivingEntry: Entry | null = null;
  for (const [songId, group] of bySong) {
    const star = posOf(songId);
    if (!star) continue;
    group.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
    const shift = songId === currentSongId ? 1 : 0; // your own ship takes the first slot at your star
    group.forEach((d, rank) => {
      const fan = rank + shift;
      if (arriving && d.id === arriving.dockId) {
        arrivingEntry = makeEntry(d.id, d.shipColour, d.isSample, 2, star);
        arrivingEntry.fan = fan;
        arrivingEntry.startedAt = arriving.startedAt;
        return;
      }
      if (away.has(d.id) || fan >= MAX_FAN) return;
      const e = makeEntry(d.id, d.shipColour, d.isSample, 0, star);
      e.fan = fan;
      out.push(e);
    });
  }
  const home = posOf(currentSongId) ?? { x: 0, y: 0 };
  parked.forEach((p, k) => {
    if (arriving && p.dock.id === arriving.dockId) return; // flying in; it parks when it lands
    const e = makeEntry(p.dock.id, p.dock.shipColour, p.dock.isSample, 1, home);
    e.park = k;
    out.push(e);
  });
  const ae = arrivingEntry as Entry | null;
  if (ae) {
    ae.park = Math.max(0, parked.findIndex((p) => p.dock.id === ae.dockId));
    if (!parked.some((p) => p.dock.id === ae.dockId)) ae.park = parked.length;
    out.push(ae);
  }
  return out;
}

