import { easeInOut } from './controls.ts';

/** Position along a flight arc: ground (x, y) eased between the stars, plus height `h` above the plane. */
export function arcPoint(
  from: { x: number; y: number }, to: { x: number; y: number }, t: number,
  out: { x: number; y: number; h: number } = { x: 0, y: 0, h: 0 },
): { x: number; y: number; h: number } {
  const e = easeInOut(t);
  const peak = Math.max(8, 0.1 * Math.hypot(to.x - from.x, to.y - from.y));
  out.x = from.x + (to.x - from.x) * e;
  out.y = from.y + (to.y - from.y) * e;
  out.h = peak * Math.sin(Math.PI * e);
  return out;
}

const RING_CAPACITY = 4096;

/**
 * Frame-time watchdog. `sample(dtMs)` goes 'low' once a full window's average frame time exceeds
 * the threshold, and back to 'high' when a full window averages under 0.8 x threshold.
 * Allocation-free after creation.
 */
export function createQualityMonitor(opts: { thresholdMs?: number; windowMs?: number } = {}) {
  const { thresholdMs = 22, windowMs = 3000 } = opts;
  const ring = new Float32Array(RING_CAPACITY);
  let head = 0; // index of the oldest sample
  let count = 0;
  let sum = 0;
  let quality: 'high' | 'low' = 'high';
  return {
    sample(dtMs: number): 'high' | 'low' {
      if (!(dtMs >= 0) || !Number.isFinite(dtMs)) return quality;
      if (count === RING_CAPACITY) { sum -= ring[head]!; head = (head + 1) % RING_CAPACITY; count--; }
      ring[(head + count) % RING_CAPACITY] = dtMs;
      count++;
      sum += dtMs;
      // keep the smallest run of newest samples that still covers a full window
      while (count > 1 && sum - ring[head]! >= windowMs) { sum -= ring[head]!; head = (head + 1) % RING_CAPACITY; count--; }
      if (sum >= windowMs) {
        const avg = sum / count;
        if (quality === 'high' && avg > thresholdMs) quality = 'low';
        else if (quality === 'low' && avg < 0.8 * thresholdMs) quality = 'high';
      }
      return quality;
    },
  };
}
