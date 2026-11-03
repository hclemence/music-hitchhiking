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
