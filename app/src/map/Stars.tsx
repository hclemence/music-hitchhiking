import { useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StarBuffers } from './stars.ts';

const vertex = /* glsl */ `
  attribute float size;
  attribute vec3 aColour;
  uniform float uPx;
  varying vec3 vColour;
  void main() {
    vColour = aColour;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = size * 1700.0 / max(-mv.z, 1.0);
    gl_PointSize = clamp(px, 4.5, 44.0) * uPx;
    gl_Position = projectionMatrix * mv;
  }
`;
const fragment = /* glsl */ `
  varying vec3 vColour;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.55, 0.0, d);
    float halo = pow(1.0 - d, 2.5);
    gl_FragColor = vec4(vColour * (0.8 * halo + core * 1.2) + vec3(core * 0.25), 1.0);
  }
`;

export function Stars({ buffers }: { buffers: StarBuffers }) {
  const gl = useThree((s) => s.gl);
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    g.setAttribute('aColour', new THREE.BufferAttribute(buffers.colours, 3));
    g.setAttribute('size', new THREE.BufferAttribute(buffers.sizes, 1));
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: { uPx: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, [buffers]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => { material.uniforms.uPx!.value = gl.getPixelRatio(); });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/** Faint, far-away dust so empty space is not flat black. Not tied to any song. */
export function Dust() {
  const { geometry, material } = useMemo(() => {
    const n = 700;
    const pos = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(a) * 4000, u * 4000, r * Math.sin(a) * 4000], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: '#8a93b8', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.45,
      depthWrite: false,
    });
    return { geometry: g, material: m };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
