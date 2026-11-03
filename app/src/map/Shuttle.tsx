import { useMemo } from 'react';
import * as THREE from 'three';
import { buildShuttle, buildSimpleShuttle, createOutlineMaterial, type ShuttleGeometry } from './shuttle.ts';

let full: ShuttleGeometry | null = null;
let simple: ReturnType<typeof buildSimpleShuttle> | null = null;
const getFull = () => (full ??= buildShuttle());
const getSimple = () => (simple ??= buildSimpleShuttle());

const outlineMaterials = new Map<number, THREE.ShaderMaterial>();
function outlineFor(opacity: number): THREE.ShaderMaterial {
  let m = outlineMaterials.get(opacity);
  if (!m) {
    m = createOutlineMaterial();
    m.uniforms.uOpacity!.value = opacity;
    m.transparent = opacity < 1;
    outlineMaterials.set(opacity, m);
  }
  return m;
}

const GLASS = '#1d3048';
const GLOW = '#fff0c2';

/** The outlined shuttle, ~1 unit long, nose toward -Z, one colour. */
export function Shuttle({
  colour, opacity = 1, lod = 'full', mine = false,
}: { colour: string; opacity?: number; lod?: 'full' | 'simple'; mine?: boolean }) {
  const geo = lod === 'full' ? getFull() : getSimple();
  const outline = useMemo(() => outlineFor(opacity), [opacity]);
  const ghost = opacity < 1;
  const scale = mine ? 1.2 : 1;
  return (
    <group scale={scale}>
      <mesh geometry={geo.paint}>
        <meshStandardMaterial
          color={colour} roughness={0.5} metalness={0.2} flatShading
          transparent={ghost} opacity={opacity} depthWrite={!ghost}
        />
      </mesh>
      <mesh geometry={geo.outline} material={outline} />
      {lod === 'full' && (
        <>
          <mesh geometry={getFull().glass}>
            <meshStandardMaterial
              color={GLASS} emissive="#4a8cc4" emissiveIntensity={0.6} roughness={0.1} metalness={0.2}
              transparent={ghost} opacity={opacity} depthWrite={!ghost}
            />
          </mesh>
          <mesh geometry={getFull().glow}>
            <meshBasicMaterial color={GLOW} side={THREE.DoubleSide} transparent={ghost} opacity={opacity} />
          </mesh>
        </>
      )}
    </group>
  );
}
