import type { Vec3 } from './types.ts';
import { add, distance, randomUnitVector, randomUnitVector2D, scale } from './vec.ts';

export const ISLAND_MIN_RADIUS = 1100;
export const ISLAND_MAX_RADIUS = 1200;
export const OFFSET_FRACTION = 0.1;
export const LOCAL_RADIUS_K = 30;
export const DEFAULT_LOCAL_RADIUS = 100;

export type PlacementOptions = { planar?: boolean };

export type Neighbour = {
  position: Vec3 | null;
  weight: number;
  localRadius: number | null;
};

const clamp01 = (w: number): number => Math.min(1, Math.max(0, w));

/**
 * Position a new song near its similar neighbours: the weighted mean of their
 * positions plus a random offset of up to 10% of their mean local radius.
 * With no positioned neighbour (position null or weight 0) the song becomes an
 * island on a shell of radius 1100..1200 around the origin (a ring in the
 * z = 0 plane when opts.planar).
 */
export function placeSong(
  neighbours: readonly Neighbour[],
  rng: () => number,
  opts: PlacementOptions = {},
): { position: Vec3; island: boolean } {
  const usable = neighbours
    .map((n) => ({ position: n.position, weight: clamp01(n.weight), localRadius: n.localRadius }))
    .filter((n): n is { position: Vec3; weight: number; localRadius: number | null } =>
      n.position !== null && n.weight > 0
    );

  if (usable.length === 0) {
    const dir = (opts.planar ? randomUnitVector2D : randomUnitVector)(rng);
    const radius = ISLAND_MIN_RADIUS + rng() * (ISLAND_MAX_RADIUS - ISLAND_MIN_RADIUS);
    return { position: scale(dir, radius), island: true };
  }

  let total = 0;
  let sum: Vec3 = { x: 0, y: 0, z: 0 };
  let radiusSum = 0;
  for (const n of usable) {
    total += n.weight;
    sum = add(sum, scale(n.position, n.weight));
    radiusSum += n.localRadius ?? DEFAULT_LOCAL_RADIUS;
  }
  const mean = scale(sum, 1 / total);
  const meanRadius = radiusSum / usable.length;

  const length = rng() * OFFSET_FRACTION * meanRadius;
  return { position: add(mean, scale((opts.planar ? randomUnitVector2D : randomUnitVector)(rng), length)), island: false };
}

/** A point at (1 - weight) * localRadius from the anchor, in a random direction. */
export function placeAround(
  anchor: Vec3,
  weight: number,
  localRadius: number,
  rng: () => number,
  opts: PlacementOptions = {},
): Vec3 {
  return add(anchor, scale((opts.planar ? randomUnitVector2D : randomUnitVector)(rng), (1 - clamp01(weight)) * localRadius));
}

/**
 * Distance from p to its k-th nearest other point; the farthest if fewer than
 * k others; DEFAULT_LOCAL_RADIUS if there are none. Callers exclude p itself.
 */
export function computeLocalRadius(
  p: Vec3,
  others: readonly Vec3[],
  k: number = LOCAL_RADIUS_K,
): number {
  if (others.length === 0) return DEFAULT_LOCAL_RADIUS;
  const sorted = others.map((o) => distance(p, o)).sort((a, b) => a - b);
  return sorted[Math.min(k, sorted.length) - 1];
}

/** Index of the centroid closest to p. Throws on an empty list. */
export function nearestRegion(p: Vec3, centroids: readonly Vec3[]): number {
  if (centroids.length === 0) throw new Error('nearestRegion: no centroids');
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const d = distance(p, centroids[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
