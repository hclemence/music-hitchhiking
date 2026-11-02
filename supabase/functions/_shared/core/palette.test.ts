import { expect, test } from 'vitest';
import { regionPalette, SHIP_COLOURS } from './palette.ts';
import { seededRng } from './rng.ts';

const HEX = /^#[0-9a-f]{6}$/;

function ring(n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]);
}

function complete(n: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  return pairs;
}

function randomGraph(n: number, seed: string, maxDeg: number): [number, number][] {
  const rng = seededRng(seed);
  const deg = new Array<number>(n).fill(0);
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (let k = 0; k < n * 6; k++) {
    const a = Math.floor(rng() * n), b = Math.floor(rng() * n);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key) || deg[a] >= maxDeg || deg[b] >= maxDeg) continue;
    seen.add(key);
    deg[a]++; deg[b]++;
    pairs.push([a, b]);
  }
  return pairs;
}

function maxDegree(n: number, pairs: readonly (readonly [number, number])[]): number {
  const deg = new Array<number>(n).fill(0);
  for (const [a, b] of pairs) { deg[a]++; deg[b]++; }
  return Math.max(...deg);
}

test('SHIP_COLOURS has 12 unique hex colours', () => {
  expect(SHIP_COLOURS).toHaveLength(12);
  expect(new Set(SHIP_COLOURS).size).toBe(12);
  expect(SHIP_COLOURS.every((c) => HEX.test(c))).toBe(true);
  expect(SHIP_COLOURS[0]).toBe('#e8554e');
  expect(SHIP_COLOURS[11]).toBe('#e9e4d8');
});

test('same seed gives same palette; different seed gives different palette', () => {
  const adj = ring(40);
  const a1 = regionPalette('seed-a', 40, adj);
  const a2 = regionPalette('seed-a', 40, adj);
  const b = regionPalette('seed-b', 40, adj);
  expect(a1).toEqual(a2);
  expect(a1).not.toEqual(b);
});

test('adjacent regions never share a colour', () => {
  const complete12 = complete(12);
  for (const seed of ['s1', 's2', 's3']) {
    const p = regionPalette(seed, 12, complete12);
    for (const [a, b] of complete12) expect(p[a]).not.toBe(p[b]);
    expect(new Set(p).size).toBe(12);
  }

  const g = randomGraph(40, 'graph', 20);
  expect(maxDegree(40, g)).toBeLessThanOrEqual(20);
  expect(g.length).toBeGreaterThan(40);
  for (const seed of ['s1', 's2', 's3']) {
    const p = regionPalette(seed, 40, g);
    for (const [a, b] of g) expect(p[a]).not.toBe(p[b]);
  }
});

test('adjacency tolerates duplicates, reversed pairs and self-pairs', () => {
  const p = regionPalette('d', 3, [[0, 1], [1, 0], [0, 1], [2, 2], [1, 2]]);
  expect(p).toHaveLength(3);
  expect(p[0]).not.toBe(p[1]);
  expect(p[1]).not.toBe(p[2]);
});

test('returns regionCount valid hex strings', () => {
  for (const n of [0, 1, 5, 40]) {
    const p = regionPalette('hex', n, ring(Math.max(n, 3)).filter(([a, b]) => a < n && b < n));
    expect(p).toHaveLength(n);
    expect(p.every((c) => HEX.test(c))).toBe(true);
  }
});
