import { useEffect, useRef, useState } from 'react';
import { createDemoBackend } from '../backend/demo.ts';
import type { Hop, Region, Song, PublicDock } from '../backend/types.ts';
import sampleMap from '../../../data/sample-map.json';
import { MapScene, type FlightState } from '../map/MapScene.tsx';

/** Dev-only smoke harness: open the app with ?scene=1. */
export function SceneHarness() {
  const [data, setData] = useState<{ stars: Song[]; docks: PublicDock[]; regions: Region[] } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [route, setRoute] = useState<Hop[]>([]);
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
      setRoute([{ id: 'h0', parentHopId: null, songId: s0.id, kind: 'start', createdAt: new Date().toISOString() }]);
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
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <MapScene
        stars={data.stars} regions={data.regions} docks={data.docks} colourSeed="dev-seed"
        currentSongId={current} myDockId={null} myShipColour="#ffd166"
        routeHops={route} extraSongs={NO_EXTRA} parked={[]} arriving={null} flight={flight}
        onFlightEnd={() => {
          const to = target.current!;
          next.current = next.current.slice(1);
          setRoute((r) => [...r, { id: `h${r.length}`, parentHopId: r[r.length - 1]!.id, songId: to, kind: 'hitchhike', createdAt: new Date().toISOString() }]);
          setCurrent(to);
          setFlight(null);
        }}
        onShipTap={(id) => console.log('ship', id)}
        onStarDoubleTap={(id) => console.log('star', id)}
      />
      <button
        id="fly" onClick={fly} disabled={!!flight}
        style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '12px 24px' }}
      >
        Fly
      </button>
    </div>
  );
}

const NO_EXTRA: ReadonlyMap<string, Song> = new Map();
