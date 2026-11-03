import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as DreiOrbit } from '@react-three/drei';
type OrbitControlsImpl = React.ComponentRef<typeof DreiOrbit>;
import { ShipModel } from './ShipModel.tsx';
import { dockedPosition, easeInOut, FLIGHT_MS, shipScale } from './controls.ts';

export type Vec3 = { x: number; y: number; z: number };
export type FlightState = { from: Vec3; to: Vec3; startedAt: number };

const prev = new THREE.Vector3();
const to = new THREE.Vector3();
const fromV = new THREE.Vector3();
const star = new THREE.Vector3();

/**
 * Your ship flying from `flight.from` to `flight.to` over 1500 ms (ease-in-out) while the
 * controls target - and the camera with it - follows. `startedAt` is a performance.now() time.
 */
export function Flight({
  flight, colour, controls, onEnd,
}: {
  flight: FlightState;
  colour: string;
  controls: React.RefObject<OrbitControlsImpl | null>;
  onEnd: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const done = useRef(false);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g || done.current) return;
    const t = (performance.now() - flight.startedAt) / FLIGHT_MS;
    const e = easeInOut(t);
    fromV.set(flight.from.x, flight.from.y, flight.from.z);
    to.set(flight.to.x, flight.to.y, flight.to.z);
    star.copy(fromV).lerp(to, e); // the star-space point (camera target)
    const sc = shipScale(camera, star);
    g.scale.setScalar(sc);
    // docked offset at both ends, blended, so it leaves and lands where docked ships sit
    dockedPosition(camera, star, sc, 0, g.position);
    g.lookAt(to);
    const c = controls.current;
    if (c) {
      prev.copy(c.target);
      c.target.copy(star);
      camera.position.add(prev.negate().add(star)); // keep the same view offset
      c.update();
    }
    if (t >= 1) {
      done.current = true;
      onEnd();
    }
  });
  return (
    <group ref={group} position={[flight.from.x, flight.from.y, flight.from.z]}>
      <ShipModel colour={colour} />
    </group>
  );
}
