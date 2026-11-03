import { describe, expect, test } from 'vitest';
import { findEncounters, nextEncounter } from './encounters.ts';
import { seededRng } from './rng.ts';
import type { PublicDock, Star } from './types.ts';

const star = (id: string, x: number, r = 10): Star => ({
  id, x, y: 0, z: 0, localRadius: r, regionId: 0, brightness: 1,
});
const dock = (id: string, songId: string, updatedAt = '2026-01-01T00:00:00Z'): PublicDock => ({
  id, songId, isSample: false, shipColour: '#ffffff', updatedAt,
});

const current = star('c', 0, 10);

type Args = Partial<Parameters<typeof findEncounters>[0]>;
function run(stars: Star[], docks: PublicDock[], over: Args = {}) {
  return findEncounters({
    current,
    stars: new Map([current, ...stars].map((s) => [s.id, s])),
    docks,
    ownDockId: null,
    pathSongIds: new Set(),
    seenDockIds: new Set(),
    rng: seededRng('t'),
    ...over,
  });
}

/** Stars on the x-axis, each with one dock; songs are named `s<x>`. */
function field(xs: number[]) {
  const stars = xs.map((x) => star(`s${x}`, x));
  const docks = xs.map((x) => dock(`d${x}`, `s${x}`));
  return { stars, docks };
}

test('returns 2 near (<5) then 1 far (5..10)', () => {
  const { stars, docks } = field([2, 3, 4, 7, 8]);
  const result = run(stars, docks);
  expect(result).toHaveLength(3);
  expect(result[0].distance).toBeLessThan(5);
  expect(result[1].distance).toBeLessThan(5);
  expect(result[2].distance).toBeGreaterThanOrEqual(5);
  expect(result[2].distance).toBeLessThanOrEqual(10);
});

test('excludes own dock, current song, path songs, seen docks, inactive songs', () => {
  const stars = [
    star('own', 2), star('p', 3), star('seen', 4),
    star('near1', 1), star('near45', 4.5), star('far6', 6),
  ];
  const docks = [
    dock('dOwn', 'own'),
    dock('dP', 'p'),
    dock('dSeen', 'seen'),
    dock('dMissing', 'missing'), // song not in stars (inactive)
    dock('dCur', 'c'),           // current song, not in pathSongIds
    dock('dNear1', 'near1'),
    dock('dNear45', 'near45'),
    dock('dFar6', 'far6'),
  ];
  // Exactly two eligible near candidates and one far, so the result is fixed for any seed;
  // every excluded dock sits in the near band and would change the result if it leaked through.
  for (let i = 0; i < 20; i++) {
    const result = run(stars, docks, {
      ownDockId: 'dOwn',
      pathSongIds: new Set(['p']),
      seenDockIds: new Set(['dSeen']),
      rng: seededRng(`excl${i}`),
    });
    expect(result.map((e) => e.songId).sort()).toEqual(['far6', 'near1', 'near45']);
  }
});

test('groups docks per song: newest shown, othersCount counts the rest', () => {
  const stars = [star('a', 2)];
  const docks = [
    dock('d2', 'a', '2026-01-02T00:00:00Z'),
    dock('d3', 'a', '2026-01-03T00:00:00Z'),
    dock('d1', 'a', '2026-01-01T00:00:00Z'),
  ];
  const result = run(stars, docks);
  expect(result).toHaveLength(1);
  expect(result[0].dock.id).toBe('d3');
  expect(result[0].othersCount).toBe(2);
});

test('widens radius x1.5 when a band is short', () => {
  // r=10: near (<5) is empty. r=15: near (<7.5) holds 6 and 7, far (7.5..15) holds 9 and 10.
  // The nearest-3 fallback would always give 6, 7, 9, so seeing 10 proves widening happened.
  const { stars, docks } = field([6, 7, 9, 10]);
  const thirds = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const result = run(stars, docks, { rng: seededRng(`widen${i}`) });
    expect(result).toHaveLength(3);
    expect(result[0].distance).toBeLessThan(7.5);
    expect(result[1].distance).toBeLessThan(7.5);
    expect(result[2].distance).toBeGreaterThanOrEqual(7.5);
    expect(result[2].distance).toBeLessThanOrEqual(15);
    thirds.add(result[2].songId);
  }
  expect(thirds.has('s10')).toBe(true);
});

test('after 6 widenings returns nearest 3', () => {
  const stars = ['a', 'b', 'c2', 'd', 'e'].map((id) => star(id, 1));
  const docks = stars.map((s) => dock(`d-${s.id}`, s.id));
  const result = run(stars, docks);
  expect(result).toHaveLength(3);
  expect(result.every((e) => e.distance === 1)).toBe(true);
});

test('fewer than 3 candidates returns all, nearest first', () => {
  const { stars, docks } = field([9, 3]);
  const result = run(stars, docks);
  expect(result.map((e) => e.distance)).toEqual([3, 9]);
});

test('returns nothing when there are no candidates', () => {
  expect(run([], [])).toEqual([]);
});

test('deterministic for a given rng seed', () => {
  const { stars, docks } = field([1, 2, 3, 4, 6, 7, 8, 9]);
  const a = run(stars, docks, { rng: seededRng('same') });
  const b = run(stars, docks, { rng: seededRng('same') });
  expect(a).toEqual(b);
});

test('chooses randomly among surplus members of a band', () => {
  const { stars, docks } = field([1, 2, 3, 4, 6, 7, 8, 9]);
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    seen.add(run(stars, docks, { rng: seededRng(`seed${i}`) }).map((e) => e.songId).join());
  }
  expect(seen.size).toBeGreaterThan(1);
});

// ---- nextEncounter ----

const star2 = (id: string, x: number, y: number, z = 0): Star => ({
  id, x, y, z, localRadius: 10, regionId: 0, brightness: 1,
});

function next(stars: Star[], docks: PublicDock[], over: Partial<Parameters<typeof nextEncounter>[0]> = {}) {
  return nextEncounter({
    current,
    stars: new Map([current, ...stars].map((s) => [s.id, s])),
    docks,
    ownDockId: null,
    pathSongIds: new Set(),
    metDockIds: new Set(),
    ...over,
  });
}

describe('nextEncounter', () => {
  test('returns the nearest by 2D distance, ignoring z', () => {
    const far = star2('far', 5, 0, 0);
    const tall = star2('tall', 1, 1, 500);
    const r = next([far, tall], [dock('d1', 'far'), dock('d2', 'tall')]);
    expect(r?.songId).toBe('tall');
    expect(r?.distance).toBeCloseTo(Math.SQRT2);
  });

  test('excludes own dock, current song, path songs, met docks, unknown songs', () => {
    const stars = [star2('a', 1, 0), star2('b', 2, 0), star2('c2', 3, 0), star2('d', 4, 0), star2('e', 5, 0)];
    const docks = [
      dock('own', 'a'), dock('onCurrent', 'c'), dock('p', 'b'), dock('met', 'c2'),
      dock('ghost', 'nowhere'), dock('ok', 'e'),
    ];
    const r = next(stars, docks, {
      ownDockId: 'own', pathSongIds: new Set(['b']), metDockIds: new Set(['met']),
    });
    expect(r?.dock.id).toBe('ok');
  });

  test('groups same-song docks: newest shown, othersCount is the rest', () => {
    const r = next([star2('a', 1, 0)], [
      dock('old', 'a', '2026-01-01T00:00:00Z'),
      dock('new', 'a', '2026-03-01T00:00:00Z'),
      dock('mid', 'a', '2026-02-01T00:00:00Z'),
    ]);
    expect(r?.dock.id).toBe('new');
    expect(r?.othersCount).toBe(2);
  });

  test('a met newest dock still offers the next-newest unmet dock', () => {
    const r = next([star2('a', 1, 0)], [
      dock('old', 'a', '2026-01-01T00:00:00Z'),
      dock('new', 'a', '2026-03-01T00:00:00Z'),
      dock('mid', 'a', '2026-02-01T00:00:00Z'),
    ], { metDockIds: new Set(['new']) });
    expect(r?.dock.id).toBe('mid');
    expect(r?.othersCount).toBe(1);
  });

  test('ties are broken by smaller dock id', () => {
    const r = next([star2('a', 1, 0), star2('b', -1, 0)], [dock('d2', 'a'), dock('d1', 'b')]);
    expect(r?.dock.id).toBe('d1');
  });

  test('returns null when nothing is left', () => {
    expect(next([], [])).toBeNull();
    expect(next([star2('a', 1, 0)], [dock('d', 'a')], { metDockIds: new Set(['d']) })).toBeNull();
  });

  test('repeated calls yield every eligible song once in distance order', () => {
    const stars = [star2('a', 3, 0), star2('b', 1, 0), star2('c2', 2, 4), star2('d', 0, 2)];
    const docks = [dock('1', 'a'), dock('2', 'b'), dock('3', 'c2'), dock('4', 'd'), dock('5', 'b', '2026-05-01T00:00:00Z')];
    const met = new Set<string>();
    const songs: string[] = [];
    for (let e = next(stars, docks, { metDockIds: met }); e; e = next(stars, docks, { metDockIds: met })) {
      if (!songs.includes(e.songId)) songs.push(e.songId);
      met.add(e.dock.id);
    }
    expect(songs).toEqual(['b', 'd', 'a', 'c2']);
  });
});
