import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { ShipModel } from './ShipModel.tsx';

function Spinner({ colour }: { colour: string }) {
  const g = useRef<Group>(null);
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.8; });
  return <group ref={g} rotation={[0.35, 0, 0]} scale={1.1}><ShipModel colour={colour} /></group>;
}

/** A small slowly rotating ship in its own canvas. */
export function ShipPreview({ colour }: { colour: string }) {
  return (
    <div className="ship-preview" aria-hidden="true">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.6, 3], fov: 40 }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[2, 3, 4]} intensity={2} />
        <Spinner colour={colour} />
      </Canvas>
    </div>
  );
}
