import { useEffect, useRef, useState } from 'react';
import { createDemoBackend } from '../backend/demo.ts';
import type { Hop, Region, Song, PublicDock } from '../backend/types.ts';
import type { ShownEncounter } from '../state/useExplore.ts';
import sampleMap from '../../../data/sample-map.json';
import { MapScene, type FlightState } from '../map/MapScene.tsx';

/** Dev-only smoke harness: open the app with ?scene=1. */
export function SceneHarness() {
  const [data, setData] = useState<{ stars: Song[]; docks: PublicDock[]; regions: Region[] } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [route, setRoute] = useState<Hop[]>([]);
  const [parked, setParked] = useState<ShownEncounter[]>([]);
  const [arriving, setArriving] = useState<{ dockId: string; startedAt: number } | null>(null);
  const target = useRef<string | null>(null);
  const next = useRef<string[]>([]);

  useEffect(() => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(), key: () => null, length: 0,
    } as Storage;
    createDemoBackend(sampleMap as never, storage).loadMap().then((m) => {
      const s0 = m.stars[0]!;
      const dist = (s: Song) => Math.hypot(s.x - s0.x, s.y - s0.y);
      const near = m.stars.filter((s) => s.id !== s0.id).sort((a, b) => dist(a) - dist(b));
      next.current = near.slice(0, 4).map((s) => s.id);
      // A route with a branch (h1 and h3 both leave h0) and a jump (h4), so the trail look can be checked.
      const at = new Date().toISOString();
      const far = m.stars[Math.floor(m.stars.length / 2)]!.id;
      const [n1, n2, n3] = [near[12], near[24], near[36]].map((s) => s.id);
      setRoute([
        { id: 'h0', parentHopId: null, songId: s0.id, kind: 'start', createdAt: at },
        { id: 'h1', parentHopId: 'h0', songId: n1!, kind: 'hitchhike', createdAt: at },
        { id: 'h2', parentHopId: 'h1', songId: n2!, kind: 'hitchhike', createdAt: at },
        { id: 'h3', parentHopId: 'h0', songId: n3!, kind: 'hitchhike', createdAt: at },
        { id: 'h4', parentHopId: 'h3', songId: far, kind: 'jump', createdAt: at },
      ]);
      setData(m);
      setCurrent(s0.id);
    });
  }, []);

  if (!data || !current) return null;
  const pos = (id: string) => data.stars.find((s) => s.id === id)!;
  const fly = () => {
    const to = next.current[0]!;
    target.current = to;
    const a = pos(current), b = pos(to);
    setFlight({ from: { x: a.x, y: a.y, z: 0 }, to: { x: b.x, y: b.y, z: 0 }, startedAt: performance.now() });
  };
  // A dock at some other star, not already parked or arriving, for the park / arrive buttons.
  const pickDock = (): ShownEncounter | null => {
    const used = new Set([...parked.map((p) => p.dock.id), arriving?.dockId]);
    const d = data.docks.find((k) => k.songId !== current && !used.has(k.id));
    if (!d) return null;
    const song = pos(d.songId);
    return { songId: d.songId, dock: d, othersCount: 0, distance: 0, song };
  };
  const park = () => { const e = pickDock(); if (e && parked.length < 4) setParked((p) => [...p, e]); };
  const arrive = () => {
    const e = pickDock();
    if (!e) return;
    setArriving({ dockId: e.dock.id, startedAt: performance.now() });
    setTimeout(() => { setParked((p) => [...p, e]); setArriving(null); }, 1200);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <MapScene
        stars={data.stars} regions={data.regions} docks={data.docks} colourSeed="dev-seed"
        currentSongId={current} myDockId={null} myShipColour="#ffd166"
        routeHops={route} extraSongs={NO_EXTRA} parked={parked} arriving={arriving} flight={flight}
        onFlightEnd={() => {
          const to = target.current!;
          next.current = next.current.slice(1);
          setRoute((r) => [...r, { id: `h${r.length}`, parentHopId: 'h0', songId: to, kind: 'hitchhike', createdAt: new Date().toISOString() }]);
          setCurrent(to);
          setFlight(null);
        }}
        onShipTap={(id) => console.log('ship', id)}
        onStarDoubleTap={(id) => console.log('star', id)}
        onVisitedTap={(id) => console.log('visited', id)}
      />
      <button
        id="fly" onClick={fly} disabled={!!flight}
        style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '12px 24px' }}
      >
        Fly
      </button>
      <button id="park" onClick={park} style={{ position: 'absolute', bottom: 24, left: 12, padding: '12px' }}>Park</button>
      <button id="arrive" onClick={arrive} style={{ position: 'absolute', bottom: 24, right: 12, padding: '12px' }}>Arrive</button>
    </div>
  );
}

const NO_EXTRA: ReadonlyMap<string, Song> = new Map();
