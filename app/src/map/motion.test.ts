import { describe, expect, it } from 'vitest';
import { ambientOffset, arcPoint, createQualityMonitor, dprFor, easeToward, fanSlot, parkingSlot, selectShipLod } from './motion.ts';

describe('arcPoint', () => {
  const from = { x: 10, y: 20 }, to = { x: 70, y: 100 };
  it('starts at from and ends at to, on the ground', () => {
    const a = arcPoint(from, to, 0), b = arcPoint(from, to, 1);
    expect(a.x).toBeCloseTo(10); expect(a.y).toBeCloseTo(20); expect(a.h).toBeCloseTo(0);
    expect(b.x).toBeCloseTo(70); expect(b.y).toBeCloseTo(100); expect(b.h).toBeCloseTo(0);
  });
  it('peaks at max(8, 0.1 x distance) at the midpoint', () => {
    expect(arcPoint(from, to, 0.5).h).toBeCloseTo(10); // dist 100
    expect(arcPoint({ x: 0, y: 0 }, { x: 30, y: 40 }, 0.5).h).toBeCloseTo(8); // dist 50 -> 5 -> 8
    const mid = arcPoint(from, to, 0.5);
    expect(mid.x).toBeCloseTo(40); expect(mid.y).toBeCloseTo(60);
  });
  it('writes into a supplied out object and returns it (no allocation)', () => {
    const out = { x: 0, y: 0, h: 0 };
    const r = arcPoint(from, to, 0.5, out);
    expect(r).toBe(out);
    expect(out.x).toBeCloseTo(40); expect(out.h).toBeCloseTo(10);
  });
  it('clamps t outside 0..1', () => {
    expect(arcPoint(from, to, 2).x).toBeCloseTo(70);
    expect(arcPoint(from, to, -1).x).toBeCloseTo(10);
  });
});

describe('createQualityMonitor', () => {
  const feed = (m: ReturnType<typeof createQualityMonitor>, ms: number, dt: number) => {
    let q: 'high' | 'low' = 'high';
    for (let t = 0; t < ms; t += dt) q = m.sample(dt);
    return q;
  };
  it('stays high under 16 ms frames', () => {
    expect(feed(createQualityMonitor(), 10000, 16)).toBe('high');
  });
  it('goes low after 3 s of 30 ms frames, not before', () => {
    const m = createQualityMonitor({ warmupMs: 0 });
    expect(feed(m, 2000, 30)).toBe('high');
    expect(feed(m, 1020, 30)).toBe('low');
  });
  it('recovers after a window under 0.8 x threshold', () => {
    const m = createQualityMonitor({ warmupMs: 0 });
    expect(feed(m, 3300, 30)).toBe('low');
    expect(feed(m, 1000, 20)).toBe('low'); // between 17.6 and 22: stays low
    expect(feed(m, 3300, 16)).toBe('high');
  });
  it('honours custom threshold and window', () => {
    const m = createQualityMonitor({ thresholdMs: 10, windowMs: 1000, warmupMs: 0 });
    expect(feed(m, 1100, 12)).toBe('low');
  });
  it('ignores a single huge sample (tab return) amid good frames', () => {
    const m = createQualityMonitor();
    feed(m, 3000, 16); // warm-up and a good start
    expect(m.sample(5000)).toBe('high');
    expect(feed(m, 10000, 16)).toBe('high');
  });
  it('ignores slow frames during the 2 s warm-up, then judges', () => {
    const m = createQualityMonitor();
    expect(feed(m, 2000, 100)).toBe('high'); // slow start (shader compiles): not judged
    expect(feed(m, 2900, 16)).toBe('high');
    expect(feed(m, 3300, 30)).toBe('low');
  });
  it('warms up again after a pause or restart()', () => {
    const m = createQualityMonitor();
    feed(m, 3000, 16);
    m.sample(60000);
    expect(feed(m, 2000, 100)).toBe('high');
    feed(m, 3000, 16);
    m.restart();
    expect(feed(m, 2000, 100)).toBe('high');
  });
});

describe('dprFor', () => {
  it('is 1 when low, and the device ratio capped to [1, 2] when high', () => {
    expect(dprFor('low', 3)).toBe(1);
    expect(dprFor('high', 3)).toBe(2);
    expect(dprFor('high', 1.5)).toBe(1.5);
    expect(dprFor('high', 0.5)).toBe(1);
    expect(dprFor('high', NaN)).toBe(1);
  });
});

describe('easeToward', () => {
  it('moves linearly and stops at the target', () => {
    expect(easeToward(0, 1, 250, 1000)).toBeCloseTo(0.25);
    expect(easeToward(0.9, 1, 250, 1000)).toBe(1);
    expect(easeToward(1, 0, 250, 1000)).toBeCloseTo(0.75);
    expect(easeToward(0.1, 0, 250, 1000)).toBe(0);
  });
});

describe('ambientOffset', () => {
  it('scales the drift by an amplitude between 0 and 1', () => {
    let ok = false;
    for (let t = 0; t < 120000 && !ok; t += 50) {
      const full = ambientOffset('a', t, undefined, 1), half = ambientOffset('a', t, undefined, 0.5), none = ambientOffset('a', t, undefined, false);
      const r = (o: { dx: number; dy: number }, base: { dx: number; dy: number }) => Math.hypot(o.dx - base.dx, o.dy - base.dy);
      const df = r(full, none);
      if (df > 5) { expect(r(half, none)).toBeCloseTo(df / 2, 5); ok = true; }
    }
    expect(ok).toBe(true);
  });
  it('is deterministic per id and differs between ids', () => {
    expect(ambientOffset('a', 12345)).toEqual(ambientOffset('a', 12345));
    expect(ambientOffset('a', 12345)).not.toEqual(ambientOffset('b', 12345));
  });
  it('stays bounded: loop <= 3, bob <= 0.6, drift <= 15', () => {
    let maxR = 0, maxH = 0;
    for (let t = 0; t < 180000; t += 100) {
      const o = ambientOffset('dock-1', t);
      maxR = Math.max(maxR, Math.hypot(o.dx, o.dy));
      maxH = Math.max(maxH, Math.abs(o.dh));
    }
    expect(maxR).toBeLessThanOrEqual(3 + 15 + 1e-6);
    expect(maxH).toBeLessThanOrEqual(0.6 + 1e-6);
  });
  it('drifts out beyond the loop at least once in any 60 s window', () => {
    for (const id of ['a', 'b', 'c', 'dock-99']) {
      for (let start = 0; start < 120000; start += 7000) {
        let far = 0;
        for (let t = start; t < start + 60000; t += 50) {
          const o = ambientOffset(id, t);
          far = Math.max(far, Math.hypot(o.dx, o.dy));
        }
        expect(far).toBeGreaterThan(8);
      }
    }
  });
  it('does not allocate-share: returns an object usable with an out param', () => {
    const out = { dx: 0, dy: 0, dh: 0 };
    expect(ambientOffset('a', 5, out)).toBe(out);
  });
});

describe('slots', () => {
  const distinct = (pts: { dx: number; dy: number }[]) =>
    new Set(pts.map((p) => `${p.dx.toFixed(3)},${p.dy.toFixed(3)}`)).size;
  it('fanSlot gives 5 distinct slots, slot 0 beside the star', () => {
    const s = [0, 1, 2, 3, 4].map(fanSlot);
    expect(distinct(s)).toBe(5);
    expect(s[0]!.dx).toBeGreaterThan(0);
  });
  it('parkingSlot gives 4 distinct slots', () => {
    expect(distinct([0, 1, 2, 3].map(parkingSlot))).toBe(4);
  });
});

describe('selectShipLod', () => {
  const view = { x: 0, y: 0, halfWidth: 100, halfHeight: 100 };
  it('culls outside the view rect (+10% margin)', () => {
    const r = selectShipLod([
      { dockId: 'in', x: 50, y: 50 }, { dockId: 'edge', x: 105, y: 0 }, { dockId: 'out', x: 200, y: 0 },
    ], view);
    expect([...r.full, ...r.simple].sort()).toEqual(['edge', 'in']);
  });
  it('gives the nearest maxFull the full model, sorted by distance, the rest simple', () => {
    const ships = Array.from({ length: 10 }, (_, i) => ({ dockId: `s${i}`, x: (9 - i) * 5, y: 0 }));
    const r = selectShipLod(ships, view, 3);
    expect(r.full).toEqual(['s9', 's8', 's7']);
    expect(r.simple.length).toBe(7);
  });
  it('defaults to 150 full', () => {
    const ships = Array.from({ length: 200 }, (_, i) => ({ dockId: `s${i}`, x: (i % 20) * 4, y: Math.floor(i / 20) * 4 }));
    const r = selectShipLod(ships, view);
    expect(r.full.length).toBe(150);
    expect(r.simple.length).toBe(50);
  });
});
