import { useMemo } from 'react';
import type { Hop, PublicDock, Song } from '../backend/types.ts';
import sampleMap from '../../../data/sample-map.json';
import { MapScene } from '../map/MapScene.tsx';
import { SHIP_COLOURS } from '../../../supabase/functions/_shared/core/palette.ts';

/**
 * Dev-only performance probe: open the app with ?perf=1. Renders 10,000 random stars and 200 docks
 * on the real MapScene. Frame timing is read by `e2e/perf.probe.ts`, not here.
 */
const STARS = 10_000;
const DOCKS = 200;
const SPREAD = 3000;
const NO_EXTRA: ReadonlyMap<string, Song> = new Map();
const NO_HOPS: Hop[] = [];

/** Small deterministic generator, so runs are comparable. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function build() {
  const rnd = lcg(42);
  const regions = sampleMap.regions as unknown as { id: number; x: number; y: number; z: number; adjacent: number[] }[];
  const stars: Song[] = Array.from({ length: STARS }, (_, i) => ({
    id: `p${i}`, title: `Star ${i}`, artist: 'Perf', x: (rnd() - 0.5) * SPREAD, y: (rnd() - 0.5) * SPREAD, z: 0,
    regionId: regions[i % regions.length]!.id, localRadius: 50, brightness: rnd(),
    spotifyUrl: '', appleUrl: '', youtubeUrl: '',
  }));
  const docks: PublicDock[] = Array.from({ length: DOCKS }, (_, i) => ({
    id: `pd${i}`, songId: stars[Math.floor(rnd() * STARS)]!.id, isSample: i % 3 !== 0,
    shipColour: SHIP_COLOURS[i % SHIP_COLOURS.length]!, updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  }));
  return { stars, docks, regions };
}

export function PerfHarness() {
  const { stars, docks, regions } = useMemo(build, []);
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <MapScene
        stars={stars} regions={regions} docks={docks} colourSeed="perf-seed"
        currentSongId={stars[0]!.id} myDockId={null} myShipColour="#ffd166"
        routeHops={NO_HOPS} extraSongs={NO_EXTRA} parked={[]} arriving={null} flight={null}
      />
    </div>
  );
}
