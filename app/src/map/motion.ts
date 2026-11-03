import { easeInOut } from './controls.ts';
import { seededRng } from '@core/rng.ts';

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
/** Frame gaps longer than this are pauses (tab return, a stall), not slowness. */
export const MAX_SAMPLE_MS = 250;
/** After mount and after each pause, frames are not judged for this long (shader compiles, resumes). */
export const WARMUP_MS = 2000;

/**
 * Frame-time watchdog. `sample(dtMs)` goes 'low' once a full window's average frame time exceeds
 * the threshold, and back to 'high' when a full window averages under 0.8 x threshold.
 * A sample over `MAX_SAMPLE_MS` is a pause: it is dropped, the window is cleared and the warm-up
 * starts again; frames during the warm-up are not judged. `restart()` does the same (for example on
 * a return to the foreground). Allocation-free after creation.
 */
export function createQualityMonitor(opts: { thresholdMs?: number; windowMs?: number; warmupMs?: number; maxSampleMs?: number } = {}) {
  const { thresholdMs = 22, windowMs = 3000, warmupMs = WARMUP_MS, maxSampleMs = MAX_SAMPLE_MS } = opts;
  const ring = new Float32Array(RING_CAPACITY);
  let head = 0; // index of the oldest sample
  let count = 0;
  let sum = 0;
  let warm = warmupMs; // warm-up time still to go
  let quality: 'high' | 'low' = 'high';
  const restart = () => { head = 0; count = 0; sum = 0; warm = warmupMs; };
  return {
    restart,
    sample(dtMs: number): 'high' | 'low' {
      if (!(dtMs >= 0) || !Number.isFinite(dtMs)) return quality;
      if (dtMs > maxSampleMs) { restart(); return quality; }
      if (warm > 0) { warm -= dtMs; return quality; }
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

/** Canvas pixel ratio per quality: 1 when low, the device ratio capped at 2 when high. */
export function dprFor(quality: 'high' | 'low', deviceRatio: number): number {
  if (quality === 'low') return 1;
  return Math.min(2, Math.max(1, Number.isFinite(deviceRatio) ? deviceRatio : 1));
}

/** Move `current` toward `target` by at most `dt / durationMs` of the 0..1 range (a linear ease in or out). */
export function easeToward(current: number, target: number, dtMs: number, durationMs: number): number {
  const step = dtMs / durationMs;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

// ---------------------------------------------------------------------------------------------
// Ships: ambient idle motion, slots and level of detail

export const LOOP_RADIUS = 3;
export const BOB = 0.6;
export const DRIFT_DISTANCE = 15;
export const DRIFT_MS = 4000;

type Ambient = { loopMs: number; loopPhase: number; bobMs: number; bobPhase: number; driftEveryMs: number; driftPhase: number; driftAngle: number };
const ambientCache = new Map<string, Ambient>();
function ambientFor(dockId: string): Ambient {
  let a = ambientCache.get(dockId);
  if (!a) {
    const r = seededRng(`ambient:${dockId}`);
    a = {
      loopMs: 6000 + r() * 4000, loopPhase: r() * Math.PI * 2,
      bobMs: 3000 + r() * 2500, bobPhase: r() * Math.PI * 2,
      driftEveryMs: 20000 + r() * 40000, driftPhase: r(), driftAngle: r() * Math.PI * 2,
    };
    ambientCache.set(dockId, a);
  }
  return a;
}

/**
 * Where a docked ship idles relative to its slot at time `tMs`: a slow loop (radius 3, one lap every
 * 6-10 s), a bob (+-0.6) and, every 20-60 s, a 4 s out-and-back drift of up to 15 units. All phases are
 * seeded from the dock id. Pass `out` to avoid allocating.
 */
export function ambientOffset(
  dockId: string, tMs: number, out: { dx: number; dy: number; dh: number } = { dx: 0, dy: 0, dh: 0 },
  driftAmp: boolean | number = 1,
): { dx: number; dy: number; dh: number } {
  const a = ambientFor(dockId);
  const la = (tMs / a.loopMs) * Math.PI * 2 + a.loopPhase;
  let dx = Math.cos(la) * LOOP_RADIUS, dy = Math.sin(la) * LOOP_RADIUS;
  const into = (tMs + a.driftPhase * a.driftEveryMs) % a.driftEveryMs;
  const amp = driftAmp === true ? 1 : driftAmp === false ? 0 : driftAmp;
  if (amp > 0 && into < DRIFT_MS) {
    const u = into / DRIFT_MS;
    const s = Math.sin(Math.PI * u);
    const k = DRIFT_DISTANCE * s * s * amp;
    // each drift picks a slightly different heading, derived from the cycle number
    const cycle = Math.floor((tMs + a.driftPhase * a.driftEveryMs) / a.driftEveryMs);
    const ang = a.driftAngle + cycle * 2.399963;
    dx += Math.cos(ang) * k * 0.8; dy += Math.sin(ang) * k * 0.8;
  }
  out.dx = dx; out.dy = dy;
  out.dh = Math.sin((tMs / a.bobMs) * Math.PI * 2 + a.bobPhase) * BOB;
  return out;
}

/** Spacing between neighbouring slots, in ship lengths. */
export const SLOT_GAP = 1.6;

const FAN: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0.95, dy: -0.45 }, { dx: 0.95 + SLOT_GAP, dy: -0.45 }, { dx: 0.95, dy: -0.45 - SLOT_GAP },
  { dx: 0.95 + SLOT_GAP, dy: -0.45 - SLOT_GAP }, { dx: 0.95 + 2 * SLOT_GAP, dy: -0.45 - SLOT_GAP / 2 },
];
export const MAX_FAN = FAN.length;
/** Offset from a star, in ship lengths, for the i-th docked ship (newest first). */
export function fanSlot(index: number): { dx: number; dy: number } {
  return FAN[Math.max(0, Math.min(FAN.length - 1, Math.floor(index)))]!;
}

const PARK: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -1.1, dy: 0.2 }, { dx: -1.1 - SLOT_GAP, dy: 0.2 }, { dx: -1.1, dy: 0.2 + SLOT_GAP }, { dx: -1.1 - SLOT_GAP, dy: 0.2 + SLOT_GAP },
];
export const MAX_PARKED = PARK.length;
/** Offset from your ship, in ship lengths, for the i-th parked encounter. */
export function parkingSlot(index: number): { dx: number; dy: number } {
  return PARK[Math.max(0, Math.min(PARK.length - 1, Math.floor(index)))]!;
}

/** Cull ships outside the view (+10%), give the nearest `maxFull` the full model, the rest the simple one. */
export function selectShipLod(
  ships: { dockId: string; x: number; y: number }[],
  view: { x: number; y: number; halfWidth: number; halfHeight: number },
  maxFull = 150,
): { full: string[]; simple: string[] } {
  const hw = view.halfWidth * 1.1, hh = view.halfHeight * 1.1;
  const inside: { id: string; d: number }[] = [];
  for (const s of ships) {
    const dx = s.x - view.x, dy = s.y - view.y;
    if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) inside.push({ id: s.dockId, d: dx * dx + dy * dy });
  }
  inside.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return {
    full: inside.slice(0, maxFull).map((e) => e.id),
    simple: inside.slice(maxFull).map((e) => e.id),
  };
}
