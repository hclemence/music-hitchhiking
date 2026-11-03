import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { findEncounters } from '@core/encounters.ts';
import { seededRng } from '@core/rng.ts';
import type { Encounter, PublicDock } from '@core/types.ts';
import { createActionQueue } from '../backend/retry.ts';
import {
  BackendError, type Backend, type Hop, type Journey, type Profile, type Region, type Song,
} from '../backend/types.ts';
import type { FlightState } from '../map/MapScene.tsx';
import {
  currentHop, initialJourneyState, journeyReducer, pathSongIds, seenDockIds, type JourneyState,
} from './journey.ts';

export type ExploreMap = { stars: Song[]; docks: PublicDock[]; regions: Region[] };
export type ShownEncounter = Encounter & { song: Song };
export type ExploreStatus = 'loading' | 'error' | 'noHome' | 'noJourney' | 'ready';

const RELOAD_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const RETRYABLE = new Set(['network', 'unknown']);
const TOAST_MS = 4000;

const codeOf = (e: unknown): string => (e instanceof BackendError ? e.code : 'other');
const uuid = (): string => globalThis.crypto.randomUUID();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function defaultStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/**
 * Everything the Explore screen shows and does: the map, today's journey (optimistic hops),
 * the encounters at the current hop, the offline flag and the actions.
 */
export function useExplore(backend: Backend, tz: string, opts: { storage?: Storage } = {}) {
  const [map, setMap] = useState<ExploreMap | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myDock, setMyDock] = useState<{ id: string; songId: string } | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'done'>('loading');
  const [journeyMissing, setJourneyMissing] = useState(false);
  const [journey, dispatch] = useReducer(journeyReducer, initialJourneyState);
  const [extraSongs, setExtraSongs] = useState<ReadonlyMap<string, Song>>(new Map());
  const [waitCount, setWaitCount] = useState<Record<string, number>>({});
  const [encounters, setEncounters] = useState<ShownEncounter[]>([]);
  const [hopOffline, setHopOffline] = useState(false);
  const [queueOffline, setQueueOffline] = useState(false);
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set());
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inboxUnread, setInboxUnread] = useState(false);
  const [starting, setStarting] = useState(false);

  const alive = useRef(true);
  const stateRef = useRef<JourneyState>(journey);
  stateRef.current = journey;
  /** Bumped by every local journey change so a slower reload cannot overwrite it. */
  const epoch = useRef(0);
  const computedKey = useRef<string | null>(null);
  const waitRef = useRef(waitCount);
  waitRef.current = waitCount;
  const hopRunning = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => { if (alive.current) setToast((t) => (t === msg ? null : t)); }, TOAST_MS);
  }, []);

  const queue = useMemo(() => createActionQueue({
    storage: opts.storage ?? defaultStorage() ?? memoryStorage(),
    send: async (a) => {
      if (a.kind === 'like') await backend.likeDock(a.dockId);
      else await backend.markInboxSeen();
    },
  }), [backend]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => queue.subscribe((online, error) => {
    if (!alive.current) return;
    setQueueOffline(!online);
    if (error) showToast("Couldn't keep that song");
  }), [queue, showToast]);

  const loadJourney = useCallback((j: Journey) => {
    epoch.current++;
    dispatch({ type: 'loaded', journey: j });
    setJourneyMissing(false);
  }, []);

  const reload = useCallback(async () => {
    const started = epoch.current;
    try {
      const [m, p, d, j] = await Promise.all([
        backend.loadMap(), backend.getProfile(), backend.getMyDock(), backend.currentJourney(tz),
      ]);
      if (!alive.current) return;
      setMap(m);
      setProfile(p);
      setMyDock(d);
      if (!stateRef.current.pending && !hopRunning.current && started === epoch.current) {
        if (j) loadJourney(j);
        else setJourneyMissing(true);
      }
      setLoadState('done');
    } catch {
      if (!alive.current) return;
      setLoadState((s) => (s === 'done' ? s : 'error'));
    }
    if (backend.mode === 'live') {
      backend.getInbox()
        .then((items) => { if (alive.current) setInboxUnread(items.some((i) => !i.seenAt)); })
        .catch(() => {});
    }
  }, [backend, tz, loadJourney]);

  useEffect(() => {
    void reload();
    const onVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void reload(), RELOAD_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [reload]);

  // Songs by id: the map's stars plus any song fetched separately (Review Focus 3).
  const songs = useMemo(() => {
    const out = new Map<string, Song>(map?.stars.map((s) => [s.id, s]) ?? []);
    for (const [id, s] of extraSongs) if (!out.has(id)) out.set(id, s);
    return out;
  }, [map, extraSongs]);

  const hop = currentHop(journey);
  const current = hop ? songs.get(hop.songId) ?? null : null;
  const pending = journey.pending !== null;

  // Fetch the current song when it is not one of the map's stars.
  useEffect(() => {
    if (!map || !hop || songs.has(hop.songId)) return;
    const id = hop.songId;
    backend.getSongs([id]).then((found) => {
      if (!alive.current || found.length === 0) return;
      setExtraSongs((prev) => new Map([...prev, ...found.map((s) => [s.id, s] as const)]));
    }).catch(() => {});
  }, [backend, map, hop?.songId, songs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Encounters for the current hop, once per (hop, wait) pair.
  useEffect(() => {
    if (!map || !hop || !current) return;
    const n = waitCount[hop.id] ?? 0;
    const key = `${hop.id}:${n}`;
    if (computedKey.current === key) return;
    computedKey.current = key;
    const found = findEncounters({
      current,
      stars: songs,
      docks: map.docks,
      ownDockId: myDock?.id ?? null,
      pathSongIds: pathSongIds(journey),
      seenDockIds: seenDockIds(journey, hop.id),
      rng: seededRng(key),
    });
    setEncounters(found.map((e) => ({ ...e, song: songs.get(e.songId)! })));
    if (found.length > 0) dispatch({ type: 'encountersShown', hopId: hop.id, dockIds: found.map((e) => e.dock.id) });
  }, [map, hop, current, songs, myDock, waitCount, journey]);

  /** Optimistic hop with flight; bad_hop starts today's journey here and retries once; network errors retry. */
  const performHop = useCallback(async (songId: string, kind: 'hitchhike' | 'jump') => {
    const s = stateRef.current;
    const from = currentHop(s);
    if (!s.journey || s.pending || hopRunning.current || !from || from.songId === songId) return;
    hopRunning.current = true;
    epoch.current++;

    let tempId = uuid();
    let parent = from.id;
    let known = new Set(s.journey.hops.map((h) => h.id));
    const begin = () => dispatch({
      type: 'hopStarted', tempId, parentHopId: parent, songId, kind, createdAt: new Date().toISOString(),
    });
    begin();
    const a = songs.get(from.songId), b = songs.get(songId);
    if (a && b) {
      setFlight({ from: { x: a.x, y: a.y, z: a.z }, to: { x: b.x, y: b.y, z: b.z }, startedAt: performance.now() });
    }

    const confirm = (h: Hop) => {
      const n = waitRef.current[tempId] ?? 0;
      // Keep the encounters already shown for the optimistic hop.
      if (computedKey.current === `${tempId}:${n}`) computedKey.current = `${h.id}:${n}`;
      setWaitCount((w) => {
        if (!(tempId in w)) return w;
        const { [tempId]: c, ...rest } = w;
        return { ...rest, [h.id]: c! };
      });
      dispatch({ type: 'hopConfirmed', tempId, hop: h });
    };
    const fail = (msg: string) => {
      dispatch({ type: 'hopFailed', tempId });
      setFlight(null);
      showToast(msg);
    };

    let recovered = false;
    let attempt = 0;
    try {
      for (;;) {
        if (!alive.current) return;
        try {
          if (attempt > 0) {
            // The last request may have reached the server: use that hop rather than make a second one.
            const j = await backend.currentJourney(tz);
            const made = j?.hops.find((h) => !known.has(h.id) && h.parentHopId === parent
              && h.songId === songId && h.kind === kind);
            if (made) { confirm(made); break; }
          }
          confirm(await backend.hop(tz, parent, songId, kind));
          break;
        } catch (e) {
          const code = codeOf(e);
          if (code === 'bad_hop' && !recovered && attempt === 0) {
            recovered = true;
            let j: Journey | null;
            try {
              j = await backend.startJourney(tz, from.songId);
            } catch (e2) {
              if (codeOf(e2) !== 'journey_exists') throw e2;
              j = await backend.currentJourney(tz);
            }
            if (!j) throw e;
            dispatch({ type: 'hopFailed', tempId });
            loadJourney(j);
            known = new Set(j.hops.map((h) => h.id));
            tempId = uuid();
            parent = j.currentHopId;
            begin();
            continue;
          }
          if (!RETRYABLE.has(code)) throw e;
          setHopOffline(true);
          await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!);
          attempt++;
        }
      }
      if (alive.current) setHopOffline(false);
    } catch {
      if (!alive.current) return;
      setHopOffline(false);
      fail(kind === 'jump' ? "Couldn't jump there" : "Couldn't hitchhike there");
    } finally {
      hopRunning.current = false;
    }
  }, [backend, tz, songs, showToast, loadJourney]);

  const startAt = useCallback(async (songId: string) => {
    setStarting(true);
    try {
      let j: Journey | null;
      try {
        j = await backend.startJourney(tz, songId);
      } catch (e) {
        if (codeOf(e) !== 'journey_exists') throw e;
        j = await backend.currentJourney(tz);
      }
      if (j && alive.current) loadJourney(j);
    } catch {
      if (alive.current) showToast("Couldn't start there");
    } finally {
      if (alive.current) setStarting(false);
    }
  }, [backend, tz, loadJourney, showToast]);

  const moveTo = useCallback((hopId: string) => {
    const s = stateRef.current;
    if (!s.journey || s.pending || hopRunning.current || s.journey.currentHopId === hopId) return;
    if (!s.journey.hops.some((h) => h.id === hopId)) return;
    epoch.current++;
    dispatch({ type: 'movedTo', hopId });
    backend.moveTo(tz, hopId).catch(async (e) => {
      // Offline is harmless: the next hop names its parent. Otherwise re-sync with the server.
      if (RETRYABLE.has(codeOf(e)) || !alive.current) return;
      showToast("Couldn't move there");
      const started = epoch.current;
      const j = await backend.currentJourney(tz).catch(() => null);
      if (j && alive.current && started === epoch.current && !stateRef.current.pending) loadJourney(j);
    });
  }, [backend, tz, showToast, loadJourney]);

  const actions = useMemo(() => ({
    hitchhike: (e: Encounter) => void performHop(e.songId, 'hitchhike'),
    jumpTo: (songId: string) => void performHop(songId, 'jump'),
    home: () => { if (profile?.homeSongId) void performHop(profile.homeSongId, 'jump'); },
    like: (e: Encounter) => {
      if (liked.has(e.dock.id)) return;
      setLiked((prev) => new Set(prev).add(e.dock.id));
      queue.enqueue({ id: uuid(), kind: 'like', dockId: e.dock.id });
    },
    wait: () => {
      const h = currentHop(stateRef.current);
      if (h) setWaitCount((w) => ({ ...w, [h.id]: (w[h.id] ?? 0) + 1 }));
    },
    moveTo,
    startFromHome: () => { if (profile?.homeSongId) void startAt(profile.homeSongId); },
    startAt: (songId: string) => void startAt(songId),
    endFlight: () => setFlight(null),
    retryLoad: () => { setLoadState('loading'); void reload(); },
  }), [performHop, profile, liked, queue, moveTo, startAt, reload]);

  let status: ExploreStatus;
  if (loadState !== 'done') status = loadState;
  else if (!profile?.homeSongId) status = 'noHome';
  else if (journeyMissing || !journey.journey) status = 'noJourney';
  else status = 'ready';

  const hops = useMemo(() => {
    const list = journey.journey?.hops ?? [];
    return journey.pending && hop ? [...list, hop] : list;
  }, [journey, hop]);

  return {
    status,
    map,
    profile,
    myDock,
    journey,
    hops,
    currentHopId: hop?.id ?? null,
    current,
    songs,
    encounters,
    offline: hopOffline || queueOffline,
    pending,
    flight,
    liked,
    toast,
    inboxUnread,
    starting,
    actions,
  };
}

export type ExploreModel = ReturnType<typeof useExplore>;
