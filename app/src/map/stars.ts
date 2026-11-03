import type { Song } from '../backend/types.ts';

export type StarBuffers = {
  positions: Float32Array;
  colours: Float32Array;
  sizes: Float32Array;
  indexOf: Map<string, number>;
};

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad colour ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function buildStarBuffers(stars: Song[], palette: string[]): StarBuffers {
  const positions = new Float32Array(stars.length * 3);
  const colours = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  const indexOf = new Map<string, number>();
  const parsed = palette.map(parseHex);
  stars.forEach((s, i) => {
    const base = parsed[s.regionId];
    if (!base) throw new Error(`unknown regionId ${s.regionId}`);
    const k = 0.4 + 0.6 * s.brightness;
    positions.set([s.x, s.y, s.z], i * 3);
    colours.set([base[0] * k, base[1] * k, base[2] * k], i * 3);
    sizes[i] = 2 + 6 * s.brightness;
    indexOf.set(s.id, i);
  });
  return { positions, colours, sizes, indexOf };
}
