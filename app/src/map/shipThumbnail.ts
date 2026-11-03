import * as THREE from 'three';
import { buildShuttle, createOutlineMaterial } from './shuttle.ts';

/** Camera distance at which a sphere of `radius` fits the vertical FOV with a margin. */
export function fitDistance(radius: number, fovDeg: number, margin = 1.12): number {
  return (radius * margin) / Math.sin((fovDeg * Math.PI) / 360);
}

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  paint: THREE.MeshStandardMaterial;
  outline: THREE.ShaderMaterial;
}

let rig: Rig | null = null;
let unavailable = false;
const cache = new Map<string, string>();

function getRig(): Rig {
  if (rig) return rig;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe6e9ff, 0x4a3a68, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 3.5, -1.5);
  scene.add(sun);
  const geo = buildShuttle();
  const paint = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, flatShading: true });
  const outline = createOutlineMaterial(2);
  scene.add(new THREE.Mesh(geo.paint, paint));
  scene.add(new THREE.Mesh(geo.outline, outline));
  scene.add(new THREE.Mesh(geo.glass, new THREE.MeshStandardMaterial({
    color: 0x1d3048, emissive: 0x4a8cc4, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2,
  })));
  scene.add(new THREE.Mesh(geo.glow, new THREE.MeshBasicMaterial({ color: 0xfff0c2, side: THREE.DoubleSide })));
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  // Front, right, above: a 3/4 view, framed on the whole shuttle's bounding sphere.
  geo.outline.computeBoundingSphere();
  const sphere = geo.outline.boundingSphere!;
  const dir = new THREE.Vector3(0.95, 0.75, -1.45).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, fitDistance(sphere.radius + 0.02, camera.fov));
  camera.lookAt(sphere.center);
  rig = { renderer, scene, camera, paint, outline };
  return rig;
}

/** Render the shuttle once per colour to a data URL with one shared offscreen renderer. */
export function shipThumbnail(colour: string, sizePx = 40): Promise<string> {
  const key = `${colour}|${sizePx}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (unavailable) return Promise.reject(new Error('WebGL unavailable'));
  try {
    const r = getRig();
    r.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    r.renderer.setSize(sizePx, sizePx, false);
    r.paint.color.set(colour);
    r.renderer.render(r.scene, r.camera);
    const url = r.renderer.domElement.toDataURL('image/png');
    cache.set(key, url);
    return Promise.resolve(url);
  } catch (e) {
    unavailable = true;
    return Promise.reject(e instanceof Error ? e : new Error('WebGL unavailable'));
  }
}
