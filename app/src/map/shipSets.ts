import * as THREE from 'three';
import { buildShuttle, buildSimpleShuttle, createOutlineMaterial } from './shuttle.ts';

export const SAMPLE_OPACITY = 0.5;
const GLASS = '#1d3048';
const GLOW = '#fff0c2';

export type Part = THREE.InstancedMesh;
export type ShipSet = { meshes: Part[]; paint: Part; count: number; full: boolean };

/** 4 sets: [full real, full sample, simple real, simple sample]. Matrix attribute shared by a set's parts. */
let geoFull: ReturnType<typeof buildShuttle> | null = null;
let geoSimple: ReturnType<typeof buildSimpleShuttle> | null = null;

/**
 * Build the instanced meshes. Geometries are shared module-level singletons (never disposed);
 * `dispose` frees only the materials, never clears the group, and is safe to call more than once,
 * so a StrictMode effect cleanup + re-run leaves a working layer.
 */
export function buildSets(capacity: number) {
  const full = (geoFull ??= buildShuttle());
  const simple = (geoSimple ??= buildSimpleShuttle());
  const disposables: { dispose(): void }[] = [];
  const group = new THREE.Group();
  const sets: ShipSet[] = [];
  const outlines = [createOutlineMaterial(), createOutlineMaterial()];
  outlines[1]!.uniforms.uOpacity!.value = SAMPLE_OPACITY;
  outlines[1]!.transparent = true;
  const prepassMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  disposables.push(...outlines, prepassMat);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.InstancedBufferAttribute | null) => {
    const m = new THREE.InstancedMesh(geo, mat, capacity);
    if (matrix) m.instanceMatrix = matrix;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
    return m;
  };
  for (const lod of ['full', 'simple'] as const) {
    for (const sample of [false, true]) {
      const o = sample ? SAMPLE_OPACITY : 1;
      const tr = sample;
      const paintMat = new THREE.MeshStandardMaterial({
        color: '#ffffff', roughness: 0.5, metalness: 0.2, flatShading: true, transparent: tr, opacity: o, depthWrite: !tr,
      });
      disposables.push(paintMat);
      const geo = lod === 'full' ? full : simple;
      const paint = mk(geo.paint, paintMat, null);
      paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      paint.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const meshes = [paint];
      const shared = paint.instanceMatrix;
      if (tr) {
        // Translucent ships: a colourless depth pre-pass so only the nearest hull surface blends (no see-through insides).
        const pre = mk(geo.paint, prepassMat, shared);
        pre.renderOrder = -1;
        meshes.push(pre);
        paintMat.depthWrite = true;
      }
      const outline = mk(geo.outline, outlines[sample ? 1 : 0]!, shared);
      outline.renderOrder = 1;
      meshes.push(outline);
      if (lod === 'full') {
        const glassMat = new THREE.MeshStandardMaterial({
          color: GLASS, emissive: '#4a8cc4', emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2,
          transparent: tr, opacity: o, depthWrite: !tr,
        });
        const glowMat = new THREE.MeshBasicMaterial({ color: GLOW, side: THREE.DoubleSide, transparent: tr, opacity: o });
        disposables.push(glassMat, glowMat);
        meshes.push(mk(full.glass, glassMat, shared), mk(full.glow, glowMat, shared));
      }
      sets.push({ meshes, paint, count: 0, full: lod === 'full' });
    }
  }
  return { group, sets, dispose: () => { disposables.forEach((d) => d.dispose()); } };
}

