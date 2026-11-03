import { describe, expect, it } from 'vitest';
import type { PublicDock } from '@core/types.ts';
import type { ShownEncounter } from '../state/useExplore.ts';
import { buildEntries } from './shipEntries.ts';
import { fanSlot, parkingSlot } from './motion.ts';

const stars: Record<string, { x: number; y: number }> = { A: { x: 0, y: 0 }, B: { x: 100, y: 50 } };
const posOf = (id: string) => stars[id] ?? null;
const dock = (id: string, songId: string, n: number, sample = false): PublicDock => ({
  id, songId, isSample: sample, shipColour: '#ff0000', updatedAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
});
const enc = (d: PublicDock): ShownEncounter => ({ songId: d.songId, dock: d, othersCount: 0, distance: 0, song: { id: d.songId } as never });

describe('buildEntries', () => {
  it('excludes your own dock', () => {
    const e = buildEntries([dock('me', 'B', 1), dock('x', 'B', 2)], 'me', 'A', [], null, posOf);
    expect(e.map((k) => k.dockId)).toEqual(['x']);
  });
  it('draws at most 5 per star, newest first', () => {
    const docks = Array.from({ length: 8 }, (_, i) => dock(`d${i}`, 'B', i));
    const e = buildEntries(docks, null, 'A', [], null, posOf).sort((a, b) => a.fan - b.fan);
    expect(e.map((k) => k.dockId)).toEqual(['d7', 'd6', 'd5', 'd4', 'd3']);
    expect(e.map((k) => k.fan)).toEqual([0, 1, 2, 3, 4]);
  });
  it('starts at slot 1 at your current star', () => {
    const docks = [dock('a', 'A', 1), dock('b', 'A', 2), dock('c', 'A', 3), dock('d', 'A', 4), dock('e', 'A', 5)];
    const e = buildEntries(docks, null, 'A', [], null, posOf).sort((a, b) => a.fan - b.fan);
    expect(e.map((k) => k.fan)).toEqual([1, 2, 3, 4]);
  });
  it('takes parked and arriving docks off their home star', () => {
    const p = dock('p', 'B', 3), a = dock('a', 'B', 2), r = dock('r', 'B', 1);
    const e = buildEntries([p, a, r], null, 'A', [enc(p)], { dockId: 'a', startedAt: 5 }, posOf);
    const byId = new Map(e.map((k) => [k.dockId, k]));
    expect(byId.get('r')!.kind).toBe(0);
    expect(byId.get('p')!.kind).toBe(1);
    expect(byId.get('a')!.kind).toBe(2);
    expect(byId.get('a')!.startedAt).toBe(5);
    expect(e.filter((k) => k.kind === 0).map((k) => k.dockId)).toEqual(['r']);
    expect(byId.get('p')!.star).toEqual(stars.A);
  });
});

describe('slot spacing', () => {
  const gap = (s: { dx: number; dy: number }[]) => {
    let m = Infinity;
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) m = Math.min(m, Math.hypot(s[i]!.dx - s[j]!.dx, s[i]!.dy - s[j]!.dy));
    return m;
  };
  it('fan and parking slots are at least 1.6 ship lengths apart', () => {
    expect(gap([0, 1, 2, 3, 4].map(fanSlot))).toBeGreaterThanOrEqual(1.6 - 1e-9);
    expect(gap([0, 1, 2, 3].map(parkingSlot))).toBeGreaterThanOrEqual(1.6 - 1e-9);
  });
});
