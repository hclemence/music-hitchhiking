import { regionPalette } from '@core/palette.ts';
import type { Region, Song } from '../backend/types.ts';

export type StarBuffers = {
  /** (x, 0, y) on the map plane. */
  positions: Float32Array;
  sizes: Float32Array;
  brightness: Float32Array;
  /** 1 for stars you have visited (drawn with a faint ring), else 0. */
  ring: Float32Array;
  indexOf: Map<string, number>;
};

/**
 * Region id -> colour for this viewer. Region ids can be any integers (gaps, not starting at 0):
 * they are mapped onto 0..n-1 in ascending order before `regionPalette`, which needs dense indices.
 */
export function regionColours(colourSeed: string, regions: readonly Region[]): Map<number, string> {
  const ids = [...new Set(regions.map((r) => r.id))].filter(Number.isFinite).sort((a, b) => a - b);
  const index = new Map(ids.map((id, i) => [id, i]));
  const pairs: [number, number][] = [];
  for (const r of regions) {
    const i = index.get(r.id);
    if (i === undefined) continue;
    for (const a of r.adjacent) {
      const j = index.get(a);
      if (j !== undefined && j !== i) pairs.push(i < j ? [i, j] : [j, i]);
    }
  }
  const palette = regionPalette(colourSeed, ids.length, pairs);
  return new Map(ids.map((id, i) => [id, palette[i]!]));
}

/** Stars are all white: only position, size, brightness and the visited ring vary. */
export function buildStarBuffers(stars: Song[], visited: ReadonlySet<string>): StarBuffers {
  const positions = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  const brightness = new Float32Array(stars.length);
  const ring = new Float32Array(stars.length);
  const indexOf = new Map<string, number>();
  stars.forEach((s, i) => {
    const b = Number.isFinite(s.brightness) ? Math.min(1, Math.max(0, s.brightness)) : 0;
    positions[i * 3] = s.x;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = s.y;
    sizes[i] = 2 + 6 * b;
    brightness[i] = b;
    ring[i] = visited.has(s.id) ? 1 : 0;
    indexOf.set(s.id, i);
  });
  return { positions, sizes, brightness, ring, indexOf };
}
