import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * One low-poly ship, ~1 unit long, nose toward +Z: a tapered hull, two swept fins and a
 * glowing engine. Tinted by `colour`.
 */
export function ShipModel({ colour, translucent = false }: { colour: string; translucent?: boolean }) {
  const opacity = translucent ? 0.4 : 1;
  const { hull, fin, glow } = useMemo(() => {
    const hullGeo = new THREE.CylinderGeometry(0.05, 0.16, 0.75, 6, 1);
    hullGeo.rotateX(Math.PI / 2); // narrow end (top) -> +Z
    hullGeo.translate(0, 0, 0.05);
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.5, -0.4);
    finShape.lineTo(0.5, -0.15);
    finShape.lineTo(0, 0.25);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: false });
    finGeo.rotateX(-Math.PI / 2); // shape x -> out, shape y -> -z (sweeps back)
    finGeo.rotateY(0);
    return {
      hull: hullGeo,
      fin: finGeo,
      glow: new THREE.SphereGeometry(0.1, 12, 8),
    };
  }, []);
  const body = (
    <meshStandardMaterial
      color={colour} roughness={0.5} metalness={0.2} emissive={colour} emissiveIntensity={0.25}
      transparent={translucent} opacity={opacity} depthWrite={!translucent}
    />
  );
  return (
    <group>
      <mesh geometry={hull}>{body}</mesh>
      <mesh geometry={fin} position={[0.1, -0.015, -0.1]} rotation={[0, 0, 0.45]}>{body}</mesh>
      <mesh geometry={fin} position={[-0.1, 0.015, -0.1]} scale={[-1, 1, 1]} rotation={[0, 0, 0.45]}>
        {body}
      </mesh>
      <mesh geometry={glow} position={[0, 0, -0.34]}>
        <meshBasicMaterial
          color="#bfe9ff" transparent opacity={translucent ? 0.5 : 0.95}
          blending={THREE.AdditiveBlending} depthWrite={false}
        />
      </mesh>
    </group>
  );
}
