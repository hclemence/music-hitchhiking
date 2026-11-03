import { describe, expect, it } from 'vitest';
import type { Hop, Journey } from '../backend/types.ts';
import {
  currentHop,
  journeyReducer,
  pathSongIds,
  seenDockIds,
  type JourneyState,
} from './journey.ts';

const hop = (id: string, parent: string | null, songId: string, kind: Hop['kind'] = 'hitchhike'): Hop => ({
  id,
  parentHopId: parent,
  songId,
  kind,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const journey = (): Journey => ({
  id: 'j',
  currentHopId: 'h1',
  hops: [hop('h0', null, 's0', 'start'), hop('h1', 'h0', 's1')],
});
const empty: JourneyState = { journey: null, seenDockIdsByHop: {}, pending: null };
const loaded = () => journeyReducer(empty, { type: 'loaded', journey: journey() });

describe('journeyReducer', () => {
  it('loads a journey and clears pending', () => {
    const s = journeyReducer(
      { ...loaded(), pending: { tempId: 't', songId: 'x', parentHopId: 'h1', kind: 'jump' } },
      { type: 'loaded', journey: journey() },
    );
    expect(s.pending).toBeNull();
    expect(currentHop(s)?.id).toBe('h1');
  });

  it('shows an optimistic hop as current, then replaces it on confirm', () => {
    let s = journeyReducer(loaded(), {
      type: 'hopStarted', tempId: 'tmp', parentHopId: 'h1', songId: 's2', kind: 'hitchhike',
    });
    expect(currentHop(s)?.id).toBe('tmp');
    expect(currentHop(s)?.songId).toBe('s2');
    expect(pathSongIds(s).has('s2')).toBe(true);
    s = journeyReducer(s, { type: 'encountersShown', hopId: 'tmp', dockIds: ['d1'] });
    s = journeyReducer(s, { type: 'hopConfirmed', tempId: 'tmp', hop: hop('real', 'h1', 's2') });
    expect(s.pending).toBeNull();
    expect(s.journey!.hops.map((h) => h.id)).toEqual(['h0', 'h1', 'real']);
    expect(s.journey!.currentHopId).toBe('real');
    expect(currentHop(s)?.id).toBe('real');
    expect([...seenDockIds(s, 'real')]).toEqual(['d1']);
    expect(seenDockIds(s, 'tmp').size).toBe(0);
  });

  it('removes a failed hop and restores the previous current', () => {
    let s = journeyReducer(loaded(), {
      type: 'hopStarted', tempId: 'tmp', parentHopId: 'h1', songId: 's2', kind: 'jump',
    });
    s = journeyReducer(s, { type: 'hopFailed', tempId: 'tmp' });
    expect(s.pending).toBeNull();
    expect(currentHop(s)?.id).toBe('h1');
    expect(pathSongIds(s).has('s2')).toBe(false);
    expect(s.journey!.hops).toHaveLength(2);
  });

  it('movedTo changes position without adding hops; branching keeps both children', () => {
    let s = journeyReducer(loaded(), { type: 'movedTo', hopId: 'h0' });
    expect(currentHop(s)?.id).toBe('h0');
    expect(s.journey!.hops).toHaveLength(2);
    s = journeyReducer(s, { type: 'hopStarted', tempId: 't', parentHopId: 'h0', songId: 's9', kind: 'hitchhike' });
    s = journeyReducer(s, { type: 'hopConfirmed', tempId: 't', hop: hop('h2', 'h0', 's9') });
    expect(s.journey!.hops.filter((h) => h.parentHopId === 'h0').map((h) => h.id)).toEqual(['h1', 'h2']);
  });

  it('pathSongIds includes all hops songs', () => {
    expect([...pathSongIds(loaded())].sort()).toEqual(['s0', 's1']);
    expect(pathSongIds(empty).size).toBe(0);
    expect(currentHop(empty)).toBeNull();
  });

  it('accumulates seen docks per hop, deduped', () => {
    let s = loaded();
    s = journeyReducer(s, { type: 'encountersShown', hopId: 'h1', dockIds: ['a', 'b'] });
    s = journeyReducer(s, { type: 'encountersShown', hopId: 'h1', dockIds: ['b', 'c'] });
    expect([...seenDockIds(s, 'h1')]).toEqual(['a', 'b', 'c']);
    expect(seenDockIds(s, 'h0').size).toBe(0);
  });

  it('does not mutate its input', () => {
    const s = loaded();
    const frozen = structuredClone(s);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
    };
    deepFreeze(s);
    let n = journeyReducer(s, { type: 'encountersShown', hopId: 'h1', dockIds: ['a'] });
    n = journeyReducer(n, { type: 'hopStarted', tempId: 't', parentHopId: 'h1', songId: 'x', kind: 'jump' });
    deepFreeze(n);
    n = journeyReducer(n, { type: 'hopConfirmed', tempId: 't', hop: hop('r', 'h1', 'x', 'jump') });
    deepFreeze(n);
    n = journeyReducer(n, { type: 'movedTo', hopId: 'h0' });
    expect(s).toEqual(frozen);
  });
});
