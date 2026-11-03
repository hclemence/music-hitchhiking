import { describe, expect, it } from 'vitest';
import { arcPoint, createQualityMonitor } from './motion.ts';

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
    const m = createQualityMonitor();
    expect(feed(m, 2000, 30)).toBe('high');
    expect(feed(m, 1020, 30)).toBe('low');
  });
  it('recovers after a window under 0.8 x threshold', () => {
    const m = createQualityMonitor();
    expect(feed(m, 3300, 30)).toBe('low');
    expect(feed(m, 1000, 20)).toBe('low'); // between 17.6 and 22: stays low
    expect(feed(m, 3300, 16)).toBe('high');
  });
  it('honours custom threshold and window', () => {
    const m = createQualityMonitor({ thresholdMs: 10, windowMs: 1000 });
    expect(feed(m, 1100, 12)).toBe('low');
  });
});
