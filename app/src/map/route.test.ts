import { describe, expect, it } from 'vitest';
import type { Hop } from '../backend/types.ts';
import { latestHopAtSong, resolveTap, routeSegments } from './route.ts';

const hop = (id: string, parentHopId: string | null, songId: string, kind: Hop['kind'] = 'hitchhike', createdAt = '2026-11-03T10:00:00Z'): Hop =>
  ({ id, parentHopId, songId, kind, createdAt });
const P: Record<string, { x: number; y: number }> = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 10 }, d: { x: -5, y: 5 } };
const pos = (id: string) => P[id];

describe('routeSegments', () => {
  it('a chain of n hops gives n-1 segments', () => {
    const hops = [hop('1', null, 'a', 'start'), hop('2', '1', 'b'), hop('3', '2', 'c')];
    const segs = routeSegments(hops, pos);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ from: P.a, to: P.b, dashed: false, toHopId: '2' });
    expect(segs[1]!.from).toEqual(P.b);
  });
  it('a branch gives two segments from the same parent', () => {
    const hops = [hop('1', null, 'a', 'start'), hop('2', '1', 'b'), hop('3', '1', 'c')];
    const segs = routeSegments(hops, pos);
    expect(segs.map((s) => s.from)).toEqual([P.a, P.a]);
    expect(segs.map((s) => s.toHopId)).toEqual(['2', '3']);
  });
  it('jump hops are dashed', () => {
    const hops = [hop('1', null, 'a', 'start'), hop('2', '1', 'b', 'jump'), hop('3', '2', 'c')];
    expect(routeSegments(hops, pos).map((s) => s.dashed)).toEqual([true, false]);
  });
  it('a song known only through a lookup (extra song) still yields a segment', () => {
    const extra = new Map([['z', { x: 50, y: 60 }]]);
    const hops = [hop('1', null, 'a', 'start'), hop('2', '1', 'z')];
    const segs = routeSegments(hops, (id) => pos(id) ?? extra.get(id));
    expect(segs).toEqual([{ from: P.a, to: { x: 50, y: 60 }, dashed: false, toHopId: '2' }]);
  });
  it('unknown positions are skipped', () => {
    const hops = [hop('1', null, 'a', 'start'), hop('2', '1', 'nope'), hop('3', '2', 'c'), hop('4', '1', 'd')];
    expect(routeSegments(hops, pos).map((s) => s.toHopId)).toEqual(['4']);
  });
  it('a hop whose parent is missing is skipped', () => {
    expect(routeSegments([hop('2', 'gone', 'b')], pos)).toEqual([]);
  });
});

describe('latestHopAtSong', () => {
  it('picks the most recent hop at the song', () => {
    const hops = [hop('1', null, 'a', 'start', '2026-11-03T09:00:00Z'), hop('2', '1', 'b', 'hitchhike', '2026-11-03T09:05:00Z'),
      hop('3', '2', 'a', 'hitchhike', '2026-11-03T09:10:00Z')];
    expect(latestHopAtSong(hops, 'a')).toBe('3');
    expect(latestHopAtSong(hops, 'b')).toBe('2');
    expect(latestHopAtSong(hops, 'q')).toBeNull();
  });
  it('falls back to list order when times tie', () => {
    const hops = [hop('1', null, 'a', 'start'), hop('2', '1', 'a')];
    expect(latestHopAtSong(hops, 'a')).toBe('2');
  });
});

describe('resolveTap priority', () => {
  it('ship beats visited star beats nothing', () => {
    expect(resolveTap(true, 's')).toEqual({ kind: 'ship' });
    expect(resolveTap(false, 's')).toEqual({ kind: 'visited', songId: 's' });
    expect(resolveTap(false, null)).toBeNull();
  });
});
