import { useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StarBuffers } from './stars.ts';

/** Point sizes are CSS px at the default zoom, clamped to this range. */
export const STAR_MIN_PX = 3;
export const STAR_MAX_PX = 24;
const RING_PAD_PX = 8;

const vertex = /* glsl */ `
  attribute float size;
  attribute float brightness;
  attribute float ring;
  uniform float uPx;
  uniform float uRef;
  varying float vCore;
  varying float vRing;
  varying float vBright;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float base = clamp(size * uRef / max(-mv.z, 1.0), ${STAR_MIN_PX.toFixed(1)}, ${STAR_MAX_PX.toFixed(1)});
    float total = base + ring * ${RING_PAD_PX.toFixed(1)};
    vCore = base / total;
    vRing = ring;
    vBright = brightness;
    gl_PointSize = total * uPx;
    gl_Position = projectionMatrix * mv;
  }
`;
const fragment = /* glsl */ `
  varying float vCore;
  varying float vRing;
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float dd = d / vCore;
    float core = 1.0 - smoothstep(0.34, 0.62, dd);
    float glow = dd < 1.0 ? exp(-dd * dd * 3.5) * (0.55 + 0.35 * vBright) : 0.0;
    float band = vRing * smoothstep(vCore + 0.02, vCore + 0.08, d) * (1.0 - smoothstep(0.9, 1.0, d)) * 0.45;
    float a = max(max(core, glow), band);
    if (a < 0.01) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  }
`;

/** White stars on the map plane. `refDistance` is the camera distance at the default zoom. */
export function Stars({ buffers, refDistance }: { buffers: StarBuffers; refDistance: number }) {
  const gl = useThree((s) => s.gl);
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    g.setAttribute('size', new THREE.BufferAttribute(buffers.sizes, 1));
    g.setAttribute('brightness', new THREE.BufferAttribute(buffers.brightness, 1));
    g.setAttribute('ring', new THREE.BufferAttribute(buffers.ring, 1));
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: { uPx: { value: 1 }, uRef: { value: refDistance } },
      transparent: true, depthWrite: false,
    });
    return { geometry: g, material: m };
  }, [buffers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => {
    material.uniforms.uPx!.value = gl.getPixelRatio();
    material.uniforms.uRef!.value = refDistance;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />;
}
