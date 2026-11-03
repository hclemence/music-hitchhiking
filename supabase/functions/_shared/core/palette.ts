import { seededRng } from './rng.ts';

/** The 12 colours a ship can be tinted. */
export const SHIP_COLOURS: readonly string[] = [
  '#e8554e', '#f08a3c', '#f2c14e', '#9bd45a', '#3fbf7f', '#2fb5b5',
  '#3a9be0', '#5b6cf0', '#9361e8', '#d65ad1', '#f07aa6', '#e9e4d8',
];

const GOLDEN_ANGLE = 137.508;

/** HSL (h in degrees, s and l in 0..1) to lowercase `#rrggbb`. */
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * One `#rrggbb` per region, arbitrary per colourSeed, with no two adjacent
 * regions sharing a colour. Adjacency pairs are undirected; self-pairs and
 * duplicates are ignored.
 */
export function regionPalette(
  colourSeed: string,
  regionCount: number,
  adjacency: readonly (readonly [number, number])[],
): string[] {
  const neighbours: Set<number>[] = Array.from({ length: regionCount }, () => new Set());
  for (const [a, b] of adjacency) {
    if (a === b || a < 0 || b < 0 || a >= regionCount || b >= regionCount) continue;
    neighbours[a].add(b);
    neighbours[b].add(a);
  }
  const maxDegree = neighbours.reduce((m, s) => Math.max(m, s.size), 0);

  const rng = seededRng(colourSeed);
  const candidateCount = Math.max(24, maxDegree + 1);
  const h0 = rng() * 360;
  const candidates = Array.from({ length: candidateCount }, (_, i) =>
    hslToHex((h0 + i * GOLDEN_ANGLE) % 360, 0.65, i % 2 === 0 ? 0.55 : 0.7));

  // Seeded Fisher-Yates visiting order.
  const order = Array.from({ length: regionCount }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const assigned = new Array<number>(regionCount).fill(-1);
  for (const region of order) {
    const used = new Set<number>();
    for (const nb of neighbours[region]) if (assigned[nb] >= 0) used.add(assigned[nb]);
    const start = Math.floor(rng() * candidateCount);
    for (let k = 0; k < candidateCount; k++) {
      const idx = (start + k) % candidateCount;
      if (!used.has(idx)) { assigned[region] = idx; break; }
    }
  }
  return assigned.map((idx) => candidates[idx]);
}
