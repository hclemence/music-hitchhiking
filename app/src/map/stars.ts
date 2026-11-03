import { regionPalette } from '@core/palette.ts';
import type { Region, Song } from '../backend/types.ts';

export type StarBuffers = {
  positions: Float32Array;
  colours: Float32Array;
  sizes: Float32Array;
  indexOf: Map<string, number>;
};

/** Colour for a star whose region is unknown or unset. */
export const NEUTRAL_STAR_COLOUR = '#9aa0b4';

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

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

/** Unknown or null region ids get the neutral colour; this never throws on catalogue data. */
export function buildStarBuffers(stars: Song[], colours: ReadonlyMap<number, string>): StarBuffers {
  const positions = new Float32Array(stars.length * 3);
  const colourBuf = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  const indexOf = new Map<string, number>();
  const neutral = parseHex(NEUTRAL_STAR_COLOUR)!;
  const parsed = new Map<number, [number, number, number]>();
  for (const [id, hex] of colours) {
    const rgb = parseHex(hex);
    if (rgb) parsed.set(id, rgb);
  }
  stars.forEach((s, i) => {
    const regionId = s.regionId as number | null | undefined;
    const base = (regionId === null || regionId === undefined ? undefined : parsed.get(regionId)) ?? neutral;
    const brightness = Number.isFinite(s.brightness) ? Math.min(1, Math.max(0, s.brightness)) : 0;
    const k = 0.4 + 0.6 * brightness;
    positions.set([s.x, s.y, s.z], i * 3);
    colourBuf.set([base[0] * k, base[1] * k, base[2] * k], i * 3);
    sizes[i] = 2 + 6 * brightness;
    indexOf.set(s.id, i);
  });
  return { positions, colours: colourBuf, sizes, indexOf };
}
