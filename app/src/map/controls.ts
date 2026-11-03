import * as THREE from 'three';

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

/**
 * Defers a ship tap so a double-tap (star focus) can cancel it. `down` is called on every pointerdown:
 * if a ship tap is waiting and this press is close to it, the waiting tap is dropped and `down`
 * returns true (this press is the second tap, so it must not schedule another); a far-away press
 * fires the waiting tap at once.
 */
export function createShipTapGate(delayMs = 320, maxDistPx = 30) {
  let pending: { x: number; y: number; fn: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const take = () => { const p = pending; pending = null; if (p) clearTimeout(p.timer); return p; };
  return {
    down(x: number, y: number): boolean {
      const p = take();
      if (!p) return false;
      if (Math.hypot(x - p.x, y - p.y) <= maxDistPx) return true;
      p.fn();
      return false;
    },
    tap(x: number, y: number, fn: () => void) {
      take();
      const timer = setTimeout(() => { pending = null; fn(); }, delayMs);
      pending = { x, y, fn, timer };
    },
    dispose() { take(); },
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

export const MIN_VISIBLE_WIDTH = 150;
export const MAX_VISIBLE_WIDTH = 2000;
export const DEFAULT_VISIBLE_WIDTH = 600;
export const MAP_FOV = 50;
/** Camera elevation above the plane, in degrees. */
export const MAP_PITCH_DEG = 35;

/** Camera-to-target distance at which `width` map units span the viewport (vertical fov, aspect = w/h). */
export function distanceForWidth(width: number, fovDeg: number, aspect: number): number {
  return width / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(0.1, aspect));
}
