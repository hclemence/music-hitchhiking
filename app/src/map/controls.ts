import * as THREE from 'three';

export const MIN_DISTANCE = 20;
export const MAX_DISTANCE = 1500;
export const FLIGHT_MS = 1500;

export const easeInOut = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

/** Detects two quick taps close together. `tap` returns true on the second tap. */
export function createDoubleTap(maxGapMs = 320, maxDistPx = 30) {
  let last: { t: number; x: number; y: number } | null = null;
  return {
    tap(t: number, x: number, y: number): boolean {
      if (last && t - last.t <= maxGapMs && Math.hypot(x - last.x, y - last.y) <= maxDistPx) {
        last = null;
        return true;
      }
      last = { t, x, y };
      return false;
    },
  };
}

/**
 * Index of the star whose projected screen position is nearest to (px, py) and within
 * `radiusPx`, or -1. `project` maps a star index to CSS-pixel coordinates (null if behind camera).
 */
export function pickNearest(
  count: number,
  project: (i: number) => { x: number; y: number; depth: number } | null,
  px: number,
  py: number,
  radiusPx: number,
): number {
  let best = -1;
  let bestD = radiusPx;
  for (let i = 0; i < count; i++) {
    const p = project(i);
    if (!p) continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export const SHIP_SCREEN_SCALE = 0.022; // ship length as a fraction of camera distance
const ax = new THREE.Vector3();
const ay = new THREE.Vector3();

/** Ship scale that keeps it small and roughly constant on screen. */
export const shipScale = (camera: THREE.Camera, at: THREE.Vector3): number =>
  Math.max(0.3, camera.position.distanceTo(at) * SHIP_SCREEN_SCALE);

/** Sets `out` to `at` plus a docked offset (up-right, just beyond the star's glow). */
export function dockedPosition(
  camera: THREE.Camera, at: THREE.Vector3, scale: number, bob: number, out: THREE.Vector3,
): THREE.Vector3 {
  const unit = scale / SHIP_SCREEN_SCALE; // = camera distance, clamped consistently
  ax.set(1, 0, 0).applyQuaternion(camera.quaternion);
  ay.set(0, 1, 0).applyQuaternion(camera.quaternion);
  return out.copy(at)
    .addScaledVector(ax, 0.03 * unit)
    .addScaledVector(ay, 0.024 * unit + bob * scale);
}
