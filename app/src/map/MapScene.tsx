import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { PublicDock } from '@core/types.ts';
import type { Region, Song } from '../backend/types.ts';
import { buildStarBuffers, regionColours } from './stars.ts';
import { Dust, Stars } from './Stars.tsx';
import { ShipModel } from './ShipModel.tsx';
import { Flight, type FlightState, type Vec3 } from './Flight.tsx';
import {
  createFocus, createTapGesture, dockedPosition, MAX_DISTANCE, MAX_SHIPS_HERE, MIN_DISTANCE, pickNearest, shipScale,
} from './controls.ts';

export type { FlightState, Vec3 };

export type MapSceneProps = {
  stars: Song[];
  regions: Region[];
  docks: PublicDock[];
  colourSeed: string;
  currentSongId: string;
  encounterSongIds: string[];
  /** Other people's docks at the current star (not your own), newest first: drawn beside it. */
  hereDocks?: PublicDock[];
  /** Tint for your own ship. */
  myShipColour?: string;
  /** Called after a double-tapped star becomes the camera's focus (the scene focuses either way). */
  onStarDoubleTap?: (songId: string) => void;
  onShipTap?: (dockId: string) => void;
  flight: FlightState | null;
  onFlightEnd?: () => void;
};

const START_DISTANCE = 620;
const PICK_RADIUS_PX = 32;

type Controls = React.ComponentRef<typeof OrbitControls>;

function DockedShip({
  at, colour, translucent, dockId, onTap, phase, slot = 0,
}: {
  at: THREE.Vector3; colour: string; translucent: boolean; dockId?: string;
  onTap?: (dockId: string) => void; phase: number; slot?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const fwd = useMemo(() => new THREE.Quaternion(), []);
  const flip = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.4), []);
  useFrame(({ camera, clock }) => {
    const g = group.current;
    if (!g) return;
    const s = shipScale(camera, at);
    g.scale.setScalar(s);
    dockedPosition(camera, at, s, Math.sin(clock.elapsedTime * 1.2 + phase) * 0.18, g.position, slot);
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

function Scene(props: MapSceneProps) {
  const {
    stars, regions, docks, colourSeed, currentSongId, encounterSongIds, hereDocks = [],
    myShipColour = '#ffffff', onStarDoubleTap, onShipTap, flight, onFlightEnd,
  } = props;
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const palette = useMemo(() => regionColours(colourSeed, regions), [regions, colourSeed]);
  const buffers = useMemo(() => buildStarBuffers(stars, palette), [stars, palette]);
  const ids = useMemo(() => stars.map((s) => s.id), [stars]);

  const posOf = (songId: string): THREE.Vector3 | null => {
    const i = buffers.indexOf.get(songId);
    if (i === undefined) return null;
    return new THREE.Vector3(buffers.positions[i * 3], buffers.positions[i * 3 + 1], buffers.positions[i * 3 + 2]);
  };
  const currentPos = useMemo(() => posOf(currentSongId), [buffers, currentSongId]);
  // Changes only when the current star or its position does, so a reload keeps a double-tap focus.
  const currentKey = currentPos ? `${currentSongId}@${currentPos.x},${currentPos.y},${currentPos.z}` : null;

  // Double-tap focus (I1): ease the orbit centre to the tapped star. No hop; it lasts until the
  // current star changes or a flight starts, which re-centre on the current star.
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
      focus.focus(c.target, to, performance.now());
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
      camera.position.copy(currentPos).add(new THREE.Vector3(0.25, 0.35, 1).normalize().multiplyScalar(START_DISTANCE));
      placed.current = true;
    } else {
      camera.position.add(currentPos).sub(c.target);
    }
    c.target.copy(currentPos);
    c.update();
  }, [currentKey, camera, flight, focus, gl]);

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
  }, [docks, encounterSongIds, buffers]);

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
      <TapToFocus positions={buffers.positions} ids={ids} onDoubleTap={focusStar} />
      {ships.map(({ dock, at }, i) => (
        <DockedShip
          key={dock.id} at={at} colour={dock.shipColour} translucent={dock.isSample}
          dockId={dock.id} onTap={onShipTap} phase={i * 2.1}
        />
      ))}
      {currentPos && hereDocks.slice(0, MAX_SHIPS_HERE).map((dock, i) => (
        <DockedShip
          key={`here-${dock.id}`} at={currentPos} colour={dock.shipColour} translucent={dock.isSample}
          dockId={dock.id} onTap={onShipTap} phase={1.3 + i * 1.7} slot={i + 1}
        />
      ))}
      {flight ? (
        <Flight
          key={flight.startedAt}
          flight={flight} colour={myShipColour}
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
      camera={{ fov: 60, near: 0.5, far: 8000, position: [0, 0, START_DISTANCE] }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
