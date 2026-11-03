import { createHash } from 'node:crypto';
import { seededRng } from '../supabase/functions/_shared/core/rng.ts';
import { computeLocalRadius, nearestRegion } from '../supabase/functions/_shared/core/placement.ts';
import { SHIP_COLOURS } from '../supabase/functions/_shared/core/palette.ts';
import { distance, randomUnitVector } from '../supabase/functions/_shared/core/vec.ts';

export type SampleSong = {
  id: string; mbid: string; title: string; artist: string;
  x: number; y: number; z: number; regionId: number; localRadius: number;
  spotifyUrl: string; appleUrl: string; youtubeUrl: string;
};
export type SampleRegion = { id: number; x: number; y: number; z: number; adjacent: number[] };
export type SampleDock = { id: string; songId: string; shipColour: string };
export type SampleMap = { regions: SampleRegion[]; songs: SampleSong[]; docks: SampleDock[] };

const SPHERE_RADIUS = 600;
const CLUSTER_RADIUS = 140;
const MIN_CENTRE_GAP = 300;
const NEIGHBOURS = 4;
const MAX_DOCKS_PER_SONG = 2;

/** Deterministic RFC-4122-shaped (version 5) UUID from SHA-1 of artist NUL title. */
export function songUuid(artist: string, title: string): string {
  const b = createHash('sha1').update(`${artist}\u0000${title}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function buildSampleMap(
  input: { title: string; artist: string; cluster: number }[],
  seed: string,
): SampleMap {
  const rng = seededRng(seed);
  const clusterCount = 12;

  // Cluster centres on a sphere, rejection-sampled so neighbourhoods stay apart.
  const centres: { x: number; y: number; z: number }[] = [];
  let gap = MIN_CENTRE_GAP;
  for (let tries = 0; centres.length < clusterCount; tries++) {
    if (tries > 0 && tries % 500 === 0) gap *= 0.9;
    const u = randomUnitVector(rng);
    const c = { x: u.x * SPHERE_RADIUS, y: u.y * SPHERE_RADIUS, z: u.z * SPHERE_RADIUS };
    if (centres.every((o) => distance(c, o) >= gap)) centres.push(c);
  }

  const positions = input.map((s) => {
    const c = centres[s.cluster];
    const d = randomUnitVector(rng);
    const r = Math.cbrt(rng()) * CLUSTER_RADIUS;
    return { x: c.x + d.x * r, y: c.y + d.y * r, z: c.z + d.z * r };
  });

  const adj = centres.map(() => new Set<number>());
  centres.forEach((c, i) => {
    centres
      .map((o, j) => ({ j, d: distance(c, o) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d || a.j - b.j)
      .slice(0, NEIGHBOURS)
      .forEach((e) => { adj[i].add(e.j); adj[e.j].add(i); });
  });
  const regions: SampleRegion[] = centres.map((c, i) => ({
    id: i, x: round3(c.x), y: round3(c.y), z: round3(c.z),
    adjacent: [...adj[i]].sort((a, b) => a - b),
  }));
  const regionPts = regions.map((r) => ({ x: r.x, y: r.y, z: r.z }));

  const songs: SampleSong[] = input.map((s, i) => {
    const p = positions[i];
    const others = positions.filter((_, j) => j !== i);
    const id = songUuid(s.artist, s.title);
    const q = encodeURIComponent(`${s.artist} ${s.title}`);
    const pos = { x: round3(p.x), y: round3(p.y), z: round3(p.z) };
    return {
      id, mbid: id, title: s.title, artist: s.artist, ...pos,
      regionId: nearestRegion(pos, regionPts),
      localRadius: round3(computeLocalRadius(p, others, 30)),
      spotifyUrl: `https://open.spotify.com/search/${q}`,
      appleUrl: `https://music.apple.com/search?term=${q}`,
      youtubeUrl: `https://www.youtube.com/results?search_query=${q}`,
    };
  });

  // Docks: one slot per song (twice), shuffled; take the first round(n/3).
  const slots = songs.flatMap((s) => Array<string>(MAX_DOCKS_PER_SONG).fill(s.id));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const docks: SampleDock[] = slots.slice(0, Math.round(songs.length / 3)).map((songId, i) => ({
    id: songUuid('dock', `${seed}:${i}`),
    songId,
    shipColour: SHIP_COLOURS[Math.floor(rng() * SHIP_COLOURS.length)],
  }));

  return { regions, songs, docks };
}
