import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Region } from '../backend/types.ts';
import { horizonColour, MAX_SKY_REGIONS, SKY_BLEND_EPS, SKY_BLEND_POWER, SKY_DESAT, SKY_MAX, SKY_MIN, skyUniforms } from './sky.ts';

/** Plane edge in world units: follows the camera; large enough that the horizon never shows its edge. */
export const SKY_SIZE = 80000;
/** Map units per shader unit; keeps the blend/warp scale independent of map size. */
const SKY_SCALE = 1000;

const vertex = /* glsl */ `
  varying vec2 vMap;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vMap = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Most fbm octaves the shader runs (high quality); low quality runs fewer through `uOctaves`. */
export const SKY_OCTAVES = { high: 5, low: 2 } as const;

/** One shader for every quality: the octave count is a uniform, so a quality change never recompiles. */
export function skyFragment(): string {
  const f = (n: number) => n.toFixed(3);
  return /* glsl */ `
  precision highp float;
  #define MAX_REGIONS ${MAX_SKY_REGIONS}
  #define MAX_OCTAVES ${SKY_OCTAVES.high}
  uniform vec2 uCentres[MAX_REGIONS];
  uniform vec3 uColours[MAX_REGIONS];
  uniform int uCount;
  uniform float uTime;
  uniform int uOctaves;
  uniform vec2 uCentroid;
  uniform float uRadius;
  uniform vec3 uHorizon;
  varying vec2 vMap;
  float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<MAX_OCTAVES;i++){if(i>=uOctaves)break;v+=a*noise(p);p*=2.03;a*=.5;}return v;}
  float fbm2(vec2 p){return .6*noise(p)+.4*noise(p*2.03+3.1);}
  vec3 grade(vec3 c){
    float l=dot(c,vec3(.299,.587,.114));
    c=mix(vec3(l),c,${f(1 - SKY_DESAT)});
    return clamp(c,vec3(${f(SKY_MIN)}),vec3(${f(SKY_MAX)}));
  }
  void main(){
    vec2 p=vMap/${f(SKY_SCALE)};
    float fade=smoothstep(uRadius,uRadius*2.5,distance(vMap,uCentroid));
    float calm=1.-fade;
    vec2 big=calm*.8*(vec2(fbm2(p*1.6+uTime*.01),fbm2(p*1.6+9.3-uTime*.008))-.5);
    vec2 q=p+big+calm*.18*vec2(fbm(p*1.5+uTime*.02),fbm(p*1.5+7.+uTime*.018))-calm*.09;
    vec3 c=vec3(0.);float w=0.;float dmin=1e9;
    for(int i=0;i<MAX_REGIONS;i++){
      if(i>=uCount)break;
      dmin=min(dmin,distance(q,uCentres[i]/${f(SKY_SCALE)}));
    }
    for(int i=0;i<MAX_REGIONS;i++){
      if(i>=uCount)break;
      float d=distance(q,uCentres[i]/${f(SKY_SCALE)});
      float k=pow((dmin+${f(SKY_BLEND_EPS)})/(d+${f(SKY_BLEND_EPS)}),${f(SKY_BLEND_POWER)});
      c+=uColours[i]*k;w+=k;
    }
    c=w>0.?c/w:vec3(${f((SKY_MIN + SKY_MAX) / 2)});
    c*=1.+calm*(-.15+.3*fbm(q*3.-uTime*.01));
    gl_FragColor=vec4(mix(grade(c),uHorizon,fade),1.);
  }
`;
}

export function buildSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: skyFragment(),
    uniforms: {
      uCentres: { value: new Float32Array(MAX_SKY_REGIONS * 2) },
      uColours: { value: new Float32Array(MAX_SKY_REGIONS * 3) },
      uCount: { value: 0 },
      uTime: { value: 0 },
      uOctaves: { value: SKY_OCTAVES.high },
      uCentroid: { value: new THREE.Vector2() },
      uRadius: { value: 1e9 },
      uHorizon: { value: new THREE.Vector3(0.4, 0.4, 0.4) },
    },
    depthWrite: false,
    depthTest: false,
  });
}

/** Switch the sky's quality in place (a uniform, not a new material). */
export function applySkyQuality(material: THREE.ShaderMaterial, quality: 'high' | 'low'): void {
  material.uniforms.uOctaves!.value = SKY_OCTAVES[quality];
}

/** The sky's clock: runs while quality is high, holds its value while low. A long frame gap counts as 100 ms. */
export function advanceSkyTime(time: number, deltaS: number, quality: 'high' | 'low', reducedMotion: boolean): number {
  if (quality === 'low') return time;
  return time + Math.min(Math.max(deltaS, 0), 0.1) * (reducedMotion ? 0.25 : 1);
}

export function Sky({ colourSeed, regions, quality = 'high', reducedMotion = false }: {
  colourSeed: string;
  regions: readonly Region[];
  quality?: 'high' | 'low';
  reducedMotion?: boolean;
}) {
  const material = useMemo(() => buildSkyMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => applySkyQuality(material, quality), [material, quality]);
  const skyTime = useRef(0);

  useEffect(() => {
    const u = skyUniforms(colourSeed, regions);
    material.uniforms.uCentres!.value = u.centres;
    material.uniforms.uColours!.value = u.colours;
    material.uniforms.uCount!.value = u.count;
    material.uniforms.uCentroid!.value.set(u.centroid[0], u.centroid[1]);
    material.uniforms.uRadius!.value = u.radius;
    horizons.current = Array.from({ length: u.count }, (_, i) =>
      horizonColour([u.colours[i * 3]!, u.colours[i * 3 + 1]!, u.colours[i * 3 + 2]!]));
    centres.current = u.centres;
    count.current = u.count;
    seeded.current = false;
  }, [material, colourSeed, regions]);

  const mesh = useRef<THREE.Mesh>(null);
  const horizons = useRef<[number, number, number][]>([]);
  const centres = useRef<Float32Array>(new Float32Array(0));
  const count = useRef(0);
  const seeded = useRef(false);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, delta) => {
    // The plane follows the camera so the horizon never shows its edge (the shader uses world coordinates).
    mesh.current?.position.set(camera.position.x, -1, camera.position.z);
    // Horizon colour: the nearest region to where the camera looks, eased so it never pops.
    camera.getWorldDirection(fwd);
    if (count.current > 0 && fwd.y < -1e-3) {
      const t = -camera.position.y / fwd.y;
      const tx = camera.position.x + fwd.x * t, tz = camera.position.z + fwd.z * t;
      let best = 0, bd = Infinity;
      for (let i = 0; i < count.current; i++) {
        const d = (centres.current[i * 2]! - tx) ** 2 + (centres.current[i * 2 + 1]! - tz) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const h = horizons.current[best]!;
      const v = material.uniforms.uHorizon!.value as THREE.Vector3;
      if (!seeded.current) { v.set(h[0], h[1], h[2]); seeded.current = true; }
      else v.set(v.x + (h[0] - v.x) * 0.05, v.y + (h[1] - v.y) * 0.05, v.z + (h[2] - v.z) * 0.05);
    }
    // Low quality freezes the clouds where they are (no jump back to 0); they resume from there.
    skyTime.current = advanceSkyTime(skyTime.current, delta, quality, reducedMotion);
    material.uniforms.uTime!.value = skyTime.current;
  });

  return (
    <mesh ref={mesh} position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1000} frustumCulled={false}>
      <planeGeometry args={[SKY_SIZE, SKY_SIZE]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
