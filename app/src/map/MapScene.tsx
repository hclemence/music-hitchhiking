import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { regionPalette } from '@core/palette.ts';
import type { PublicDock } from '@core/types.ts';
import type { Region, Song } from '../backend/types.ts';
import { buildStarBuffers } from './stars.ts';
import { Dust, Stars } from './Stars.tsx';
import { ShipModel } from './ShipModel.tsx';
import { Flight, type FlightState, type Vec3 } from './Flight.tsx';
import { createDoubleTap, MAX_DISTANCE, MIN_DISTANCE, pickNearest } from './controls.ts';

export type { FlightState, Vec3 };

export type MapSceneProps = {
  stars: Song[];
  regions: Region[];
  docks: PublicDock[];
  colourSeed: string;
  currentSongId: string;
  encounterSongIds: string[];
  /** Tint for your own ship. */
  myShipColour?: string;
  onStarDoubleTap?: (songId: string) => void;
  onShipTap?: (dockId: string) => void;
  flight: FlightState | null;
  onFlightEnd?: () => void;
};

const SHIP_SCREEN_SCALE = 0.06; // world units per unit of camera distance
const START_DISTANCE = 360;
const PICK_RADIUS_PX = 32;

type Controls = React.ComponentRef<typeof OrbitControls>;

function DockedShip({
  at, colour, translucent, dockId, onTap, phase,
}: {
  at: THREE.Vector3; colour: string; translucent: boolean; dockId?: string;
  onTap?: (dockId: string) => void; phase: number;
}) {
  const group = useRef<THREE.Group>(null);
  const fwd = useMemo(() => new THREE.Quaternion(), []);
  const flip = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.4), []);
  useFrame(({ camera, clock }) => {
    const g = group.current;
    if (!g) return;
    const s = Math.max(0.4, camera.position.distanceTo(at) * SHIP_SCREEN_SCALE);
    g.scale.setScalar(s);
    // docked just up-and-right of the star, gently bobbing
    const bob = Math.sin(clock.elapsedTime * 1.2 + phase) * 0.18 * s;
    g.position.set(0, 0, 0)
      .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), 1.1 * s)
      .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), 0.9 * s + bob)
      .add(at);
    g.quaternion.copy(fwd.copy(camera.quaternion).multiply(flip));
  });
  return (
    <group
      ref={group}
      onClick={(e) => {
        if (!dockId || !onTap) return;
        e.stopPropagation();
        onTap(dockId);
      }}
    >
      <ShipModel colour={colour} translucent={translucent} />
      {/* generous invisible hit area for thumbs */}
      <mesh>
        <sphereGeometry args={[1.1, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function TapToFocus({
  positions, ids, onStarDoubleTap,
}: { positions: Float32Array; ids: string[]; onStarDoubleTap?: (id: string) => void }) {
  const { gl, camera, size } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const dt = createDoubleTap();
    const v = new THREE.Vector3();
    let down: { x: number; y: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
    const onUp = (e: PointerEvent) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 10) return;
      if (!dt.tap(e.timeStamp, e.clientX, e.clientY)) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const i = pickNearest(ids.length, (k) => {
        v.set(positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!).project(camera);
        if (v.z > 1) return null;
        return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, depth: v.z };
      }, px, py, PICK_RADIUS_PX);
      if (i >= 0) onStarDoubleTap?.(ids[i]!);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); };
  }, [gl, camera, size, positions, ids, onStarDoubleTap]);
  return null;
}

function Scene(props: MapSceneProps) {
  const {
    stars, regions, docks, colourSeed, currentSongId, encounterSongIds,
    myShipColour = '#ffffff', onStarDoubleTap, onShipTap, flight, onFlightEnd,
  } = props;
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);

  const palette = useMemo(() => {
    const pairs: [number, number][] = [];
    for (const r of regions) for (const a of r.adjacent) if (r.id < a) pairs.push([r.id, a]);
    return regionPalette(colourSeed, regions.length, pairs);
  }, [regions, colourSeed]);
  const buffers = useMemo(() => buildStarBuffers(stars, palette), [stars, palette]);
  const ids = useMemo(() => stars.map((s) => s.id), [stars]);

  const posOf = (songId: string): THREE.Vector3 | null => {
    const i = buffers.indexOf.get(songId);
    if (i === undefined) return null;
    return new THREE.Vector3(buffers.positions[i * 3], buffers.positions[i * 3 + 1], buffers.positions[i * 3 + 2]);
  };
  const currentPos = useMemo(() => posOf(currentSongId), [buffers, currentSongId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the current star (the flight drives the target itself while it runs).
  const placed = useRef(false);
  useEffect(() => {
    const c = controls.current;
    if (!c || !currentPos || flight) return;
    if (!placed.current) {
      camera.position.copy(currentPos).add(new THREE.Vector3(0.25, 0.35, 1).normalize().multiplyScalar(START_DISTANCE));
      placed.current = true;
    } else {
      camera.position.add(currentPos).sub(c.target);
    }
    c.target.copy(currentPos);
    c.update();
  }, [currentPos, camera, flight]);

  const ships = useMemo(() => {
    const seen = new Set<string>();
    const out: { dock: PublicDock; at: THREE.Vector3 }[] = [];
    for (const songId of encounterSongIds) {
      const dock = docks.find((d) => d.songId === songId && !seen.has(d.id));
      const at = posOf(songId);
      if (!dock || !at) continue;
      seen.add(dock.id);
      out.push({ dock, at });
    }
    return out;
  }, [docks, encounterSongIds, buffers]); // eslint-disable-line react-hooks/exhaustive-deps

  const flightScale = useRef(1);
  useFrame(() => {
    if (flight) flightScale.current = Math.max(0.4, camera.position.distanceTo(controls.current?.target ?? camera.position) * SHIP_SCREEN_SCALE);
  });

  return (
    <>
      <color attach="background" args={['#05060d']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[1, 2, 3]} intensity={2} />
      <Dust />
      <Stars buffers={buffers} />
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        minDistance={MIN_DISTANCE}
        maxDistance={MAX_DISTANCE}
      />
      <TapToFocus positions={buffers.positions} ids={ids} onStarDoubleTap={onStarDoubleTap} />
      {ships.map(({ dock, at }, i) => (
        <DockedShip
          key={dock.id} at={at} colour={dock.shipColour} translucent={dock.isSample}
          dockId={dock.id} onTap={onShipTap} phase={i * 2.1}
        />
      ))}
      {flight ? (
        <Flight
          key={flight.startedAt}
          flight={flight} colour={myShipColour} scale={flightScale.current}
          controls={controls} onEnd={() => onFlightEnd?.()}
        />
      ) : currentPos ? (
        <DockedShip at={currentPos} colour={myShipColour} translucent={false} phase={0.7} />
      ) : null}
    </>
  );
}

export function MapScene(props: MapSceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 55, near: 0.5, far: 8000, position: [0, 0, START_DISTANCE] }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
