import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LOCAL_RADIUS,
  ISLAND_MAX_RADIUS,
  ISLAND_MIN_RADIUS,
  computeLocalRadius,
  nearestRegion,
  placeAround,
  placeSong,
  type Neighbour,
} from './placement.ts';
import { seededRng } from './rng.ts';
import { distance } from './vec.ts';
import type { Vec3 } from './types.ts';

const origin: Vec3 = { x: 0, y: 0, z: 0 };

describe('placeSong', () => {
  test('lands within 10% of mean localRadius of the weighted mean', () => {
    const neighbours: Neighbour[] = [
      { position: { x: 0, y: 0, z: 0 }, weight: 0.25, localRadius: 50 },
      { position: { x: 10, y: 0, z: 0 }, weight: 0.75, localRadius: 150 },
    ];
    let maxSeen = 0;
    for (let i = 0; i < 200; i++) {
      const r = placeSong(neighbours, seededRng(`seed-${i}`));
      expect(r.island).toBe(false);
      const d = distance(r.position, { x: 7.5, y: 0, z: 0 });
      maxSeen = Math.max(maxSeen, d);
      expect(d).toBeLessThanOrEqual(10);
    }
    expect(maxSeen).toBeGreaterThan(1); // offset is actually applied
  });

  test('treats a weight above 1 as 1', () => {
    const neighbours: Neighbour[] = [
      { position: { x: 0, y: 0, z: 0 }, weight: 1, localRadius: 100 },
      { position: { x: 10, y: 0, z: 0 }, weight: 5, localRadius: 100 },
    ];
    let maxSeen = 0;
    for (let i = 0; i < 200; i++) {
      const r = placeSong(neighbours, seededRng(`cap-${i}`));
      const d = distance(r.position, { x: 5, y: 0, z: 0 });
      maxSeen = Math.max(maxSeen, d);
      expect(d).toBeLessThanOrEqual(10);
    }
    expect(maxSeen).toBeGreaterThan(1);
  });

  test('ignores neighbours without position or with weight 0', () => {
    const neighbours: Neighbour[] = [
      { position: { x: 100, y: 0, z: 0 }, weight: 1, localRadius: 20 },
      { position: null, weight: 5, localRadius: 1000 },
      { position: { x: -900, y: 0, z: 0 }, weight: 0, localRadius: 1000 },
    ];
    for (let i = 0; i < 100; i++) {
      const r = placeSong(neighbours, seededRng(`ign-${i}`));
      expect(r.island).toBe(false);
      expect(distance(r.position, { x: 100, y: 0, z: 0 })).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  test('null localRadius counts as DEFAULT_LOCAL_RADIUS', () => {
    const neighbours: Neighbour[] = [{ position: origin, weight: 1, localRadius: null }];
    for (let i = 0; i < 100; i++) {
      const r = placeSong(neighbours, seededRng(`def-${i}`));
      expect(distance(r.position, origin)).toBeLessThanOrEqual(0.1 * DEFAULT_LOCAL_RADIUS + 1e-9);
    }
  });

  test('no positioned neighbours → island on shell 1100..1200', () => {
    const cases: Neighbour[][] = [
      [],
      [{ position: null, weight: 1, localRadius: 10 }],
      [{ position: origin, weight: 0, localRadius: 10 }],
    ];
    for (const neighbours of cases) {
      for (let i = 0; i < 200; i++) {
        const r = placeSong(neighbours, seededRng(`isl-${i}`));
        const len = distance(r.position, origin);
        expect(r.island).toBe(true);
        expect(len).toBeGreaterThanOrEqual(ISLAND_MIN_RADIUS - 1e-9);
        expect(len).toBeLessThanOrEqual(ISLAND_MAX_RADIUS + 1e-9);
      }
    }
  });
});

describe('placeAround', () => {
  test('puts point at (1 - weight) * localRadius from anchor', () => {
    const anchor = { x: 5, y: -3, z: 2 };
    for (let i = 0; i < 20; i++) {
      const p = placeAround(anchor, 0.25, 40, seededRng(`pa-${i}`));
      expect(Math.abs(distance(p, anchor) - 30)).toBeLessThan(1e-9);
    }
  });

  test('clamps weight to [0, 1]', () => {
    const rng = seededRng('clamp');
    expect(distance(placeAround(origin, 2, 40, rng), origin)).toBeCloseTo(0, 9);
    expect(distance(placeAround(origin, -1, 40, rng), origin)).toBeCloseTo(40, 9);
  });
});

describe('computeLocalRadius', () => {
  const line = Array.from({ length: 40 }, (_, i) => ({ x: i + 1, y: 0, z: 0 }));

  test('is distance to k-th nearest', () => {
    expect(computeLocalRadius(origin, [...line].reverse(), 30)).toBe(30);
    expect(computeLocalRadius(origin, line)).toBe(30);
  });

  test('fewer than k others → farthest; none → DEFAULT_LOCAL_RADIUS', () => {
    expect(computeLocalRadius(origin, line.slice(0, 5), 30)).toBe(5);
    expect(computeLocalRadius(origin, [])).toBe(DEFAULT_LOCAL_RADIUS);
  });
});

describe('nearestRegion', () => {
  test('returns index of closest centroid', () => {
    const centroids = [
      { x: 100, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 },
      { x: 0, y: 0, z: 10 },
    ];
    expect(nearestRegion({ x: 1, y: 90, z: 0 }, centroids)).toBe(1);
    expect(nearestRegion({ x: 90, y: 0, z: 0 }, centroids)).toBe(0);
    expect(nearestRegion({ x: 0, y: 0, z: 0 }, centroids)).toBe(2);
  });

  test('throws on empty centroid list', () => {
    expect(() => nearestRegion(origin, [])).toThrow();
  });
});

describe('planar placement', () => {
  test('placeSong keeps z = 0 and obeys the 2D offset rule', () => {
    const neighbours: Neighbour[] = [
      { position: { x: 0, y: 0, z: 0 }, weight: 0.25, localRadius: 50 },
      { position: { x: 10, y: 0, z: 0 }, weight: 0.75, localRadius: 150 },
    ];
    for (let i = 0; i < 200; i++) {
      const r = placeSong(neighbours, seededRng(`planar-${i}`), { planar: true });
      expect(r.island).toBe(false);
      expect(r.position.z).toBe(0);
      expect(distance(r.position, { x: 7.5, y: 0, z: 0 })).toBeLessThanOrEqual(10);
    }
  });

  test('planar islands lie on the ring with z = 0', () => {
    for (let i = 0; i < 200; i++) {
      const r = placeSong([], seededRng(`ring-${i}`), { planar: true });
      expect(r.island).toBe(true);
      expect(r.position.z).toBe(0);
      const d = Math.hypot(r.position.x, r.position.y);
      expect(d).toBeGreaterThanOrEqual(ISLAND_MIN_RADIUS);
      expect(d).toBeLessThanOrEqual(ISLAND_MAX_RADIUS);
    }
  });

  test('placeAround keeps z = 0 at (1 - weight) * localRadius', () => {
    const anchor: Vec3 = { x: 5, y: -3, z: 0 };
    for (let i = 0; i < 100; i++) {
      const p = placeAround(anchor, 0.4, 100, seededRng(`pa-${i}`), { planar: true });
      expect(p.z).toBe(0);
      expect(distance(p, anchor)).toBeCloseTo(60, 6);
    }
  });
});
