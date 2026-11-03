import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { PublicDock } from '@core/types.ts';
import type { Hop, Region, Song } from '../backend/types.ts';
import type { ShownEncounter } from '../state/useExplore.ts';
import { buildStarBuffers } from './stars.ts';
import { Stars } from './Stars.tsx';
import { Sky } from './Sky.tsx';
import { Shuttle } from './Shuttle.tsx';
import { arcPoint, createQualityMonitor } from './motion.ts';
import { shipWorldLength } from './shuttle.ts';
import {
  createFocus, createTapGesture, DEFAULT_VISIBLE_WIDTH, distanceForWidth, FLIGHT_MS, MAP_FOV, MAP_PITCH_DEG,
  MAX_VISIBLE_WIDTH, MIN_VISIBLE_WIDTH, pickNearest,
} from './controls.ts';

export type Vec3 = { x: number; y: number; z: number };
/** A flight in map coordinates; `startedAt` is a performance.now() time. */
export type FlightState = { from: Vec3; to: Vec3; startedAt: number };

export type MapSceneProps = {
  stars: Song[];
  regions: Region[];
  docks: PublicDock[];
  colourSeed: string;
  currentSongId: string;
  myDockId: string | null;
  myShipColour: string;
  routeHops: Hop[];
  extraSongs: ReadonlyMap<string, Song>;
  parked: ShownEncounter[];
  arriving: { dockId: string; startedAt: number } | null;
  flight: FlightState | null;
  onFlightEnd?: () => void;
  /** Called after a double-tapped star becomes the camera's focus (the scene focuses either way). */
  onStarDoubleTap?: (songId: string) => void;
  onShipTap?: (dockId: string) => void;
  onVisitedTap?: (songId: string) => void;
  /** Legacy: the old encounter flow still passes these; the scene ignores them (Task 6/8 replace them). */
  encounterSongIds?: string[];
  hereDocks?: PublicDock[];
};

const PICK_RADIUS_PX = 32;
const PITCH = (MAP_PITCH_DEG * Math.PI) / 180;
const POLAR = Math.PI / 2 - PITCH;
/** Direction from the target to the camera (unit). */
const VIEW_DIR = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
/** Where your ship sits beside its star, in ship lengths (right and slightly up-screen). */
const DOCK_OFFSET = { x: 0.95, z: -0.45 };
const DOCKED_YAW = Math.atan2(-1, 0.35);

type Controls = React.ComponentRef<typeof MapControls>;

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function TapToFocus({
  positions, ids, onDoubleTap,
}: { positions: Float32Array; ids: string[]; onDoubleTap: (id: string) => void }) {
  const { gl, camera, size } = useThree();
  const cb = useRef(onDoubleTap);
  cb.current = onDoubleTap;
  useEffect(() => {
    const el = gl.domElement;
    const v = new THREE.Vector3();
    const gesture = createTapGesture((x, y) => {
      const rect = el.getBoundingClientRect();
      const px = x - rect.left, py = y - rect.top;
      const i = pickNearest(ids.length, (k) => {
        v.set(positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!).project(camera);
        if (v.z > 1) return null;
        return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, depth: v.z };
      }, px, py, PICK_RADIUS_PX);
      if (i >= 0) cb.current(ids[i]!);
    });
    const onDown = (e: PointerEvent) => gesture.down(e);
    const onUp = (e: PointerEvent) => gesture.up(e);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); };
  }, [gl, camera, size, positions, ids]);
  return null;
}

/** Your shuttle beside its star (or flying on an arc), a fixed apparent size, with a soft halo. */
function MyShip({
  at, flight, colour, controls, startDistance, onEnd,
}: {
  at: { x: number; y: number };
  flight: FlightState | null;
  colour: string;
  controls: React.RefObject<Controls | null>;
  startDistance: number;
  onEnd: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const done = useRef(false);
  const delta = useMemo(() => new THREE.Vector3(), []);
  const yaw = useMemo(() => {
    if (!flight) return DOCKED_YAW;
    const dx = flight.to.x - flight.from.x, dz = flight.to.y - flight.from.y;
    return dx === 0 && dz === 0 ? DOCKED_YAW : Math.atan2(-dx, -dz);
  }, [flight]);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useFrame(({ camera, size }) => {
    const g = group.current;
    const c = controls.current;
    if (!g) return;
    let x = at.x, y = at.y, h = 0;
    let finished = false;
    if (flight) {
      const t = (performance.now() - flight.startedAt) / FLIGHT_MS;
      const p = arcPoint(flight.from, flight.to, t);
      x = p.x; y = p.y; h = p.h;
      finished = t >= 1;
      if (c) {
        // The camera follows the ground point under the ship, keeping its view offset.
        delta.set(x, 0, y).sub(c.target);
        camera.position.add(delta);
        c.target.set(x, 0, y);
        c.update();
      }
    }
    const dist = c ? camera.position.distanceTo(c.target) : startDistance;
    const len = shipWorldLength(dist, MAP_FOV, size.height, { defaultDistance: startDistance, mine: false });
    g.scale.setScalar(len);
    g.position.set(x + DOCK_OFFSET.x * len, h + len * 0.25, y + DOCK_OFFSET.z * len);
    g.rotation.y = yaw;
    if (finished && !done.current) {
      done.current = true;
      onEndRef.current();
    }
  });

  return (
    <group ref={group}>
      {/* soft additive halo under the ship (rotated by the group's yaw; it is a disc, so it does not matter) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} renderOrder={2}>
        <circleGeometry args={[1.1, 32]} />
        <meshBasicMaterial color="#fff6dc" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <Shuttle colour={colour} mine />
    </group>
  );
}

function Scene(props: MapSceneProps) {
  const {
    stars, regions, colourSeed, currentSongId, extraSongs, routeHops, myShipColour,
    onStarDoubleTap, flight, onFlightEnd,
  } = props;
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));

  const startDistance = distanceForWidth(DEFAULT_VISIBLE_WIDTH, MAP_FOV, aspect);
  const minDistance = distanceForWidth(MIN_VISIBLE_WIDTH, MAP_FOV, aspect);
  const maxDistance = distanceForWidth(MAX_VISIBLE_WIDTH, MAP_FOV, aspect);
  const startRef = useRef(startDistance);
  startRef.current = startDistance;

  // Quality: a half-resolution, non-drifting sky when frames run slow.
  const monitor = useMemo(() => createQualityMonitor(), []);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const qualityRef = useRef(quality);
  useFrame((_, delta) => {
    const q = monitor.sample(delta * 1000);
    if (q !== qualityRef.current) { qualityRef.current = q; setQuality(q); }
  });
  const reducedMotion = useMemo(prefersReducedMotion, []);

  // Songs on the map, plus any the journey visited that are not stars.
  const allStars = useMemo(() => {
    if (extraSongs.size === 0) return stars;
    const have = new Set(stars.map((s) => s.id));
    const more = [...extraSongs.values()].filter((s) => !have.has(s.id));
    return more.length ? [...stars, ...more] : stars;
  }, [stars, extraSongs]);
  const visited = useMemo(() => new Set(routeHops.map((h) => h.songId)), [routeHops]);
  const buffers = useMemo(() => buildStarBuffers(allStars, visited), [allStars, visited]);
  const ids = useMemo(() => allStars.map((s) => s.id), [allStars]);

  const posOf = (songId: string): { x: number; y: number } | null => {
    const i = buffers.indexOf.get(songId);
    if (i === undefined) return null;
    return { x: buffers.positions[i * 3]!, y: buffers.positions[i * 3 + 2]! };
  };
  const currentPos = useMemo(() => posOf(currentSongId), [buffers, currentSongId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Changes only when the current star or its position does, so a reload keeps a double-tap focus.
  const currentKey = currentPos ? `${currentSongId}@${currentPos.x},${currentPos.y}` : null;

  // Double-tap focus: ease the camera target to the tapped star. No hop; it lasts until the current
  // star changes or a flight starts, which re-centre on the current star.
  const focus = useMemo(() => createFocus(), []);
  const focusTarget = useMemo(() => new THREE.Vector3(), []);
  const flying = useRef(flight !== null);
  flying.current = flight !== null;
  const posOfRef = useRef(posOf);
  posOfRef.current = posOf;
  const onStarDoubleTapRef = useRef(onStarDoubleTap);
  onStarDoubleTapRef.current = onStarDoubleTap;
  const focusStar = useCallback((songId: string) => {
    const c = controls.current;
    const to = posOfRef.current(songId);
    if (c && to && !flying.current) {
      focus.focus(c.target, new THREE.Vector3(to.x, 0, to.y), performance.now());
      gl.domElement.dataset.focusSongId = songId; // lets the e2e check see the focus
    }
    onStarDoubleTapRef.current?.(songId);
  }, [focus, gl]);
  useFrame(() => {
    const c = controls.current;
    if (!c || !focus.step(performance.now(), focusTarget)) return;
    camera.position.add(focusTarget).sub(c.target);
    c.target.copy(focusTarget);
    c.update();
  });

  // Follow the current star (the flight drives the target itself while it runs).
  const placed = useRef(false);
  useEffect(() => {
    focus.cancel();
    delete gl.domElement.dataset.focusSongId;
    const c = controls.current;
    if (!c || !currentPos || flight) return;
    if (!placed.current) {
      camera.position.set(currentPos.x, 0, currentPos.y).addScaledVector(VIEW_DIR, startRef.current);
      placed.current = true;
    } else {
      camera.position.add(new THREE.Vector3(currentPos.x, 0, currentPos.y)).sub(c.target);
    }
    c.target.set(currentPos.x, 0, currentPos.y);
    c.update();
  }, [currentKey, camera, flight, focus, gl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <color attach="background" args={['#232a44']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[1, 3, 2]} intensity={2} />
      <Sky colourSeed={colourSeed} regions={regions} quality={quality} reducedMotion={reducedMotion} />
      <Stars buffers={buffers} refDistance={startDistance} />
      <MapControls
        ref={controls}
        enableRotate={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={POLAR}
        maxPolarAngle={POLAR}
        minDistance={minDistance}
        maxDistance={maxDistance}
      />
      <TapToFocus positions={buffers.positions} ids={ids} onDoubleTap={focusStar} />
      {currentPos && (
        <MyShip
          key={flight ? flight.startedAt : 'docked'}
          at={currentPos} flight={flight} colour={myShipColour} controls={controls}
          startDistance={startDistance} onEnd={() => onFlightEnd?.()}
        />
      )}
    </>
  );
}

export function MapScene(props: MapSceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: MAP_FOV, near: 1, far: 8000, position: [0, 800, 1100] }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
