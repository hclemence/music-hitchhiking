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

type TapPointer = { isPrimary: boolean; pointerId: number; clientX: number; clientY: number; timeStamp: number };

/**
 * Canvas tap handling for double-tap focus: a primary pointer that goes down and up without
 * dragging counts as a tap; the second quick tap calls `onDoubleTap` with its client position.
 */
export function createTapGesture(onDoubleTap: (x: number, y: number) => void, maxMovePx = 10) {
  const dt = createDoubleTap();
  let down: { x: number; y: number; id: number } | null = null;
  return {
    down(e: TapPointer) {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    },
    up(e: TapPointer) {
      if (!e.isPrimary || !down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > maxMovePx) return;
      if (dt.tap(e.timeStamp, e.clientX, e.clientY)) onDoubleTap(e.clientX, e.clientY);
    },
  };
}

export const FOCUS_MS = 450;

/**
 * The orbit centre's move to a double-tapped star. `focus` starts easing from the current
 * target; `step` writes the eased target into `out` and reports whether a move is running
 * (it ends itself on arrival); `cancel` stops it (the current star changed or a flight began).
 */
export function createFocus(durationMs = FOCUS_MS) {
  let ease: { from: THREE.Vector3; to: THREE.Vector3; start: number } | null = null;
  return {
    focus(from: THREE.Vector3, to: THREE.Vector3, now: number) {
      ease = { from: from.clone(), to: to.clone(), start: now };
    },
    cancel() { ease = null; },
    get active() { return ease !== null; },
    step(now: number, out: THREE.Vector3): boolean {
      if (!ease) return false;
      const t = (now - ease.start) / durationMs;
      out.lerpVectors(ease.from, ease.to, easeInOut(t));
      if (t >= 1) ease = null;
      return true;
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
