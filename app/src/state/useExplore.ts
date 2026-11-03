import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { nextEncounter } from '@core/encounters.ts';
import type { Encounter, PublicDock } from '@core/types.ts';
import { createActionQueue, type ActionQueue } from '../backend/retry.ts';
import {
  BackendError, type Backend, type Hop, type Journey, type Profile, type Region, type Song,
} from '../backend/types.ts';
import type { FlightState } from '../map/MapScene.tsx';
import {
  currentHop, initialJourneyState, journeyReducer, pathSongIds, seenDockIds, type JourneyState,
} from './journey.ts';
import {
  FLY_IN_MS, arrived, closePopup, encounterFlowReducer, flyInDone, initialEncounterFlow, openPopup, revealed, waitPressed,
  type EncounterFlowAction, type EncounterPhase,
} from './encounterFlow.ts';

export type ExploreMap = { stars: Song[]; docks: PublicDock[]; regions: Region[] };
export type ShownEncounter = Encounter & { song: Song };
export type ExploreStatus = 'loading' | 'error' | 'noHome' | 'noJourney' | 'ready';
/** The encounter at your stop: the latest one, the ships parked beside you, the open pop-up. */
export type EncounterView = {
  phase: EncounterPhase;
  current: ShownEncounter | null;
  parked: ShownEncounter[];
  popup: ShownEncounter | null;
  nobodyLeft: boolean;
};
const NO_ENCOUNTER: EncounterView = { phase: 'idle', current: null, parked: [], popup: null, nobodyLeft: false };

const RELOAD_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const RETRYABLE = new Set(['network', 'unknown']);
const TOAST_MS = 4000;

const codeOf = (e: unknown): string => (e instanceof BackendError ? e.code : 'other');
const uuid = (): string => globalThis.crypto.randomUUID();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retryDelay = (attempt: number) => RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;

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
 * one encounter at a time at the current hop, the offline flag and the actions.
 */
export function useExplore(backend: Backend, tz: string, opts: { storage?: Storage; reloadToken?: number } = {}) {
  const [map, setMap] = useState<ExploreMap | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myDock, setMyDock] = useState<{ id: string; songId: string } | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'done'>('loading');
  const [journeyMissing, setJourneyMissing] = useState(false);
  const [journey, dispatch] = useReducer(journeyReducer, initialJourneyState);
  const [extraSongs, setExtraSongs] = useState<ReadonlyMap<string, Song>>(new Map());
  const [flow, flowDispatch] = useReducer(encounterFlowReducer, initialEncounterFlow);
  /** Every encounter revealed this session, by dock id (for the pop-up and the parked ships). */
  const [met, setMet] = useState<ReadonlyMap<string, Encounter>>(new Map());
  const [hopOffline, setHopOffline] = useState(false);
  const [queueOffline, setQueueOffline] = useState(false);
  const [songOffline, setSongOffline] = useState(false);
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
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const hopRunning = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => { if (alive.current) setToast((t) => (t === msg ? null : t)); }, TOAST_MS);
  }, []);

  // One queue per mounted screen, disposed on unmount. Created a tick after mount so React's
  // StrictMode mount/unmount/mount in development never makes two queues over the same storage.
  const queue = useRef<ActionQueue | null>(null);
  const storageOpt = opts.storage;
  useEffect(() => {
    let q: ActionQueue | null = null;
    let unsubscribe = () => {};
    const t = setTimeout(() => {
      q = createActionQueue({
        storage: storageOpt ?? defaultStorage() ?? memoryStorage(),
        send: async (a) => {
          if (a.kind === 'like') await backend.likeDock(a.dockId);
          else await backend.markInboxSeen();
        },
      });
      queue.current = q;
      unsubscribe = q.subscribe((online, error, action) => {
        if (!alive.current) return;
        setQueueOffline(!online);
        if (!error) return;
        if (action?.kind === 'like') {
          const dockId = action.dockId;
          setLiked((prev) => { const next = new Set(prev); next.delete(dockId); return next; });
        }
        showToast("Couldn't keep that song");
      });
    }, 0);
    return () => {
      clearTimeout(t);
      unsubscribe();
      q?.dispose();
      if (queue.current === q) queue.current = null;
    };
  }, [backend, storageOpt, showToast]);

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
        // No journey today (past 4am): keep showing the one already on screen (Ruling 9). The next
        // hop gets bad_hop and starts today's journey where the person is. The start picker is
        // only for when nothing has been shown yet.
        else if (!stateRef.current.journey) setJourneyMissing(true);
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

  // A screen outside Explore (Ship, Dock) changed something: load it again.
  const lastToken = useRef(opts.reloadToken ?? 0);
  useEffect(() => {
    const t = opts.reloadToken ?? 0;
    if (t === lastToken.current) return;
    lastToken.current = t;
    void reload();
  }, [opts.reloadToken, reload]);

  // Songs by id: the map's stars plus any song fetched separately (Review Focus 3).
  const songs = useMemo(() => {
    const out = new Map<string, Song>(map?.stars.map((s) => [s.id, s]) ?? []);
    for (const [id, s] of extraSongs) if (!out.has(id)) out.set(id, s);
    return out;
  }, [map, extraSongs]);

  const hop = currentHop(journey);
  const current = hop ? songs.get(hop.songId) ?? null : null;
  const pending = journey.pending !== null;

  // Fetch the current song when it is not one of the map's stars; retry while offline.
  const missingSongId = map && hop && !songs.has(hop.songId) ? hop.songId : null;
  useEffect(() => {
    if (!missingSongId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const tryFetch = () => {
      backend.getSongs([missingSongId]).then((found) => {
        if (cancelled || !alive.current) return;
        setSongOffline(false);
        if (found.length > 0) setExtraSongs((prev) => new Map([...prev, ...found.map((s) => [s.id, s] as const)]));
        else showToast("Couldn't find where you are");
      }).catch((e) => {
        if (cancelled || !alive.current) return;
        if (!RETRYABLE.has(codeOf(e))) {
          setSongOffline(false);
          showToast("Couldn't find where you are");
          return;
        }
        setSongOffline(true);
        timer = setTimeout(tryFetch, retryDelay(attempt++));
      });
    };
    tryFetch();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSongOffline(false);
    };
  }, [backend, missingSongId, showToast]);

  // ---- Encounters: one at a time (spec §7) ----
  // The stop whose encounters are shown: the confirmed current hop. While a hop is pending its id
  // is not known yet, so nothing is revealed.
  const stopId = journey.pending ? null : journey.journey?.currentHopId ?? null;
  const flowTo = useCallback((a: EncounterFlowAction) => {
    flowRef.current = encounterFlowReducer(flowRef.current, a); // so a second check in the same tick sees it
    flowDispatch(a);
  }, []);

  // Arriving at a new stop (a hop confirmed and its flight landed, a move, a load or a start)
  // starts the pause before the first reveal. A late reveal for the old stop is dropped by its hop id.
  useEffect(() => {
    if (!stopId || flight || stopId === flowRef.current.hopId) return;
    flowTo(arrived(stopId, Date.now()));
  }, [stopId, flight, flow.hopId, flowTo]);

  const live = useRef({ map, songs, myDock, flight });
  live.current = { map, songs, myDock, flight };
  /** Reveal the next encounter once the pause is over (wall clock, so a hidden tab reveals once on return). */
  const checkReveal = useCallback(() => {
    const f = flowRef.current;
    if (f.phase !== 'pending' || f.dueAt === null || f.hopId === null) return;
    // Hidden tabs still fire (throttled) timers: hold the reveal so the fly-in is seen on return.
    if (document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (now < f.dueAt) return;
    const s = stateRef.current;
    const { map: m, songs: byId, myDock: mine, flight: flying } = live.current;
    if (!m || s.pending || flying || s.journey?.currentHopId !== f.hopId) return;
    const h = currentHop(s);
    const here = h ? byId.get(h.songId) : undefined;
    if (!here) return;
    const e = nextEncounter({
      current: here,
      stars: byId,
      docks: m.docks,
      ownDockId: mine?.id ?? null,
      pathSongIds: pathSongIds(s),
      metDockIds: seenDockIds(s, f.hopId),
    });
    if (e) {
      setMet((prev) => new Map(prev).set(e.dock.id, e));
      dispatch({ type: 'encountersShown', hopId: f.hopId, dockIds: [e.dock.id] });
    }
    flowTo(revealed(f.hopId, e?.dock.id ?? null, now));
  }, [flowTo]);

  useEffect(() => {
    if (flow.phase !== 'pending' || flow.dueAt === null) return;
    const t = setTimeout(checkReveal, Math.max(0, flow.dueAt - Date.now()));
    const onVisible = () => { if (document.visibilityState === 'visible') checkReveal(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // stopId, flight, map and current: check again as soon as whatever held the reveal back clears.
  }, [flow.phase, flow.dueAt, flow.hopId, checkReveal, stopId, flight, map, current]);

  // The encountered ship lands beside yours.
  useEffect(() => {
    if (flow.phase !== 'arriving' || !flow.current) return;
    const id = flow.current;
    const t = setTimeout(() => flowTo(flyInDone(id)), FLY_IN_MS);
    return () => clearTimeout(t);
  }, [flow.phase, flow.current, flowTo]);

  const encounter = useMemo((): EncounterView => {
    if (flow.hopId === null || flow.hopId !== stopId) return NO_ENCOUNTER;
    const shown = (id: string | null): ShownEncounter | null => {
      const e = id ? met.get(id) : undefined;
      const song = e ? songs.get(e.songId) : undefined;
      return e && song ? { ...e, song } : null;
    };
    return {
      phase: flow.phase,
      current: shown(flow.current),
      parked: flow.parked.map(shown).filter((e): e is ShownEncounter => e !== null),
      popup: shown(flow.popup),
      nobodyLeft: flow.phase === 'none',
    };
  }, [flow, stopId, met, songs]);

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
      epoch.current++; // a reload that started before this cannot know the hop
      dispatch({ type: 'hopConfirmed', tempId, hop: h });
    };
    const fail = (msg: string) => {
      epoch.current++;
      dispatch({ type: 'hopFailed', tempId });
      setFlight(null);
      showToast(msg);
    };

    let recovered = false;
    let restart = false;
    let attempt = 0;
    try {
      for (;;) {
        if (!alive.current) return;
        try {
          if (restart) {
            // bad_hop: today's journey is not the one we hold (the day changed). Start it here.
            let j: Journey | null;
            try {
              j = await backend.startJourney(tz, from.songId);
            } catch (e2) {
              if (codeOf(e2) !== 'journey_exists') throw e2;
              j = await backend.currentJourney(tz);
            }
            if (!j) throw new BackendError('bad_hop');
            dispatch({ type: 'hopFailed', tempId });
            loadJourney(j);
            known = new Set(j.hops.map((h) => h.id));
            tempId = uuid();
            parent = j.currentHopId;
            begin();
            restart = false;
            attempt = 0;
            continue;
          }
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
          if (code === 'bad_hop' && !recovered) {
            recovered = true;
            restart = true;
            continue;
          }
          if (!RETRYABLE.has(code)) throw e;
          setHopOffline(true);
          await sleep(retryDelay(attempt));
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
      epoch.current++;
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
    backend.moveTo(tz, hopId).then(() => { epoch.current++; }, async (e) => {
      epoch.current++; // a reload that started before the move settled may hold the old position
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
    like: (e: { dock: { id: string } }) => {
      if (liked.has(e.dock.id)) return;
      setLiked((prev) => new Set(prev).add(e.dock.id));
      const action = { id: uuid(), kind: 'like' as const, dockId: e.dock.id };
      if (queue.current) queue.current.enqueue(action);
      else void backend.likeDock(action.dockId).catch(() => {}); // only in the first tick after mount
    },
    /** Your ship drifts a little, then the next nearest ship is revealed. */
    wait: () => {
      const s = stateRef.current;
      if (s.pending || !s.journey || s.journey.currentHopId !== flowRef.current.hopId) return;
      flowTo(waitPressed(Date.now()));
    },
    openEncounter: (dockId: string) => flowTo(openPopup(dockId)),
    closeEncounter: () => flowTo(closePopup()),
    moveTo,
    startFromHome: () => { if (profile?.homeSongId) void startAt(profile.homeSongId); },
    startAt: (songId: string) => void startAt(songId),
    endFlight: () => setFlight(null),
    retryLoad: () => { setLoadState('loading'); void reload(); },
  }), [backend, performHop, profile, liked, moveTo, startAt, reload, flowTo]);

  let status: ExploreStatus;
  if (loadState !== 'done') status = loadState;
  else if (!profile?.homeSongId) status = 'noHome';
  else if (journeyMissing || !journey.journey) status = 'noJourney';
  else status = 'ready';

  // Other people's docks at the current star, newest first (Ruling 11). Encounters never include
  // them, so this is how you see the ship you found or flew alongside.
  const hereDocks = useMemo(() => {
    if (!map || !current) return [];
    const ownId = myDock?.id ?? null;
    return map.docks
      .filter((d) => d.songId === current.id && d.id !== ownId)
      .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }, [map, current, myDock]);

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
    extraSongs,
    encounter,
    hereDocks,
    offline: hopOffline || queueOffline || songOffline,
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
