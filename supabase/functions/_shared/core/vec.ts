import type { Vec3 } from './types.ts';

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** Uniformly distributed point on the unit sphere. */
export function randomUnitVector(rng: () => number): Vec3 {
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(phi), y: s * Math.sin(phi), z };
}
