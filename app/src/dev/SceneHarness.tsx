import { useEffect, useRef, useState } from 'react';
import { createDemoBackend } from '../backend/demo.ts';
import type { Region, Song, PublicDock } from '../backend/types.ts';
import sampleMap from '../../../data/sample-map.json';
import { MapScene, type FlightState } from '../map/MapScene.tsx';

/** Dev-only smoke harness: open the app with ?scene=1. */
export function SceneHarness() {
  const [data, setData] = useState<{ stars: Song[]; docks: PublicDock[]; regions: Region[] } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const target = useRef<string | null>(null);
  const encounters = useRef<string[]>([]);

  useEffect(() => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(), key: () => null, length: 0,
    } as Storage;
    createDemoBackend(sampleMap as never, storage).loadMap().then((m) => {
      const start = m.stars[0]!.id;
      const picks: string[] = [];
      const s0 = m.stars[0]!;
      const dist = (id: string) => { const t = m.stars.find((x) => x.id === id)!; return Math.hypot(t.x - s0.x, t.y - s0.y, t.z - s0.z); };
      const sorted = [...m.docks].sort((a, b) => dist(a.songId) - dist(b.songId));
      for (const d of sorted) {
        if (d.songId !== start && !picks.includes(d.songId)) picks.push(d.songId);
        if (picks.length === 3) break;
      }
      encounters.current = picks;
      setData(m);
      setCurrent(start);
    });
  }, []);

  if (!data || !current) return null;
  const pos = (id: string) => data.stars.find((s) => s.id === id)!;
  const fly = () => {
    const to = encounters.current[0]!;
    target.current = to;
    const a = pos(current), b = pos(to);
    setFlight({ from: { x: a.x, y: a.y, z: a.z }, to: { x: b.x, y: b.y, z: b.z }, startedAt: performance.now() });
  };
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <MapScene
        stars={data.stars} regions={data.regions} docks={data.docks} colourSeed="dev-seed"
        currentSongId={current} encounterSongIds={encounters.current}
        myShipColour="#ffd166" flight={flight}
        onFlightEnd={() => { setCurrent(target.current!); setFlight(null); }}
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
