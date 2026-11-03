import type { Hop, Journey } from '../backend/types.ts';

export type Pending = {
  tempId: string;
  songId: string;
  parentHopId: string;
  kind: 'hitchhike' | 'jump';
};
export type JourneyState = {
  journey: Journey | null;
  seenDockIdsByHop: Record<string, string[]>;
  pending: Pending | null;
};
export type JourneyAction =
  | { type: 'loaded'; journey: Journey }
  | { type: 'hopStarted'; tempId: string; parentHopId: string; songId: string; kind: 'hitchhike' | 'jump' }
  | { type: 'hopConfirmed'; tempId: string; hop: Hop }
  | { type: 'hopFailed'; tempId: string }
  | { type: 'movedTo'; hopId: string }
  | { type: 'encountersShown'; hopId: string; dockIds: string[] };

export const initialJourneyState: JourneyState = { journey: null, seenDockIdsByHop: {}, pending: null };

function optimisticHop(p: Pending): Hop {
  return {
    id: p.tempId,
    parentHopId: p.parentHopId,
    songId: p.songId,
    kind: p.kind,
    createdAt: new Date().toISOString(),
  };
}

export function journeyReducer(s: JourneyState, a: JourneyAction): JourneyState {
  switch (a.type) {
    case 'loaded':
      return { ...s, journey: a.journey, pending: null };
    case 'hopStarted':
      return {
        ...s,
        pending: { tempId: a.tempId, songId: a.songId, parentHopId: a.parentHopId, kind: a.kind },
      };
    case 'hopConfirmed': {
      if (!s.journey) return s;
      const { [a.tempId]: seen, ...rest } = s.seenDockIdsByHop;
      const hops = [...s.journey.hops.filter((h) => h.id !== a.tempId), a.hop];
      return {
        journey: { ...s.journey, hops, currentHopId: a.hop.id },
        seenDockIdsByHop: seen ? { ...rest, [a.hop.id]: [...(rest[a.hop.id] ?? []), ...seen] } : rest,
        pending: s.pending?.tempId === a.tempId ? null : s.pending,
      };
    }
    case 'hopFailed': {
      if (s.pending?.tempId !== a.tempId) return s;
      const { [a.tempId]: _drop, ...rest } = s.seenDockIdsByHop;
      return { ...s, seenDockIdsByHop: rest, pending: null };
    }
    case 'movedTo':
      return s.journey ? { ...s, journey: { ...s.journey, currentHopId: a.hopId } } : s;
    case 'encountersShown': {
      const have = s.seenDockIdsByHop[a.hopId] ?? [];
      const merged = [...have, ...a.dockIds.filter((d, i, arr) => !have.includes(d) && arr.indexOf(d) === i)];
      return { ...s, seenDockIdsByHop: { ...s.seenDockIdsByHop, [a.hopId]: merged } };
    }
  }
}

export function currentHop(s: JourneyState): Hop | null {
  if (s.pending) return optimisticHop(s.pending);
  if (!s.journey) return null;
  return s.journey.hops.find((h) => h.id === s.journey!.currentHopId) ?? null;
}

export function pathSongIds(s: JourneyState): Set<string> {
  const ids = new Set(s.journey?.hops.map((h) => h.songId) ?? []);
  if (s.pending) ids.add(s.pending.songId);
  return ids;
}

export function seenDockIds(s: JourneyState, hopId: string): Set<string> {
  return new Set(s.seenDockIdsByHop[hopId] ?? []);
}
