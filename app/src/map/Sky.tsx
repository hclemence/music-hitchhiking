import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Region } from '../backend/types.ts';
import { MAX_SKY_REGIONS, SKY_BLEND_EPS, SKY_BLEND_POWER, SKY_DESAT, SKY_MAX, SKY_MIN, skyUniforms } from './sky.ts';

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

export function skyFragment(quality: 'high' | 'low'): string {
  const octaves = quality === 'low' ? 2 : 5;
  const f = (n: number) => n.toFixed(3);
  return /* glsl */ `
  precision highp float;
  #define MAX_REGIONS ${MAX_SKY_REGIONS}
  #define OCTAVES ${octaves}
  uniform vec2 uCentres[MAX_REGIONS];
  uniform vec3 uColours[MAX_REGIONS];
  uniform int uCount;
  uniform float uTime;
  varying vec2 vMap;
  float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<OCTAVES;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
  vec3 grade(vec3 c){
    float l=dot(c,vec3(.299,.587,.114));
    c=mix(vec3(l),c,${f(1 - SKY_DESAT)});
    return clamp(c,vec3(${f(SKY_MIN)}),vec3(${f(SKY_MAX)}));
  }
  void main(){
    vec2 p=vMap/${f(SKY_SCALE)};
    vec2 q=p+.18*vec2(fbm(p*1.5+uTime*.02),fbm(p*1.5+7.+uTime*.018))-.09;
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
    c*=.85+.3*fbm(q*3.-uTime*.01);
    gl_FragColor=vec4(grade(c),1.);
  }
`;
}

export function buildSkyMaterial(quality: 'high' | 'low'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: skyFragment(quality),
    uniforms: {
      uCentres: { value: new Float32Array(MAX_SKY_REGIONS * 2) },
      uColours: { value: new Float32Array(MAX_SKY_REGIONS * 3) },
      uCount: { value: 0 },
      uTime: { value: 0 },
    },
    depthWrite: false,
    depthTest: false,
  });
}

export function Sky({ colourSeed, regions, quality = 'high', reducedMotion = false }: {
  colourSeed: string;
  regions: readonly Region[];
  quality?: 'high' | 'low';
  reducedMotion?: boolean;
}) {
  const material = useMemo(() => buildSkyMaterial(quality), [quality]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const u = skyUniforms(colourSeed, regions);
    material.uniforms.uCentres!.value = u.centres;
    material.uniforms.uColours!.value = u.colours;
    material.uniforms.uCount!.value = u.count;
  }, [material, colourSeed, regions]);

  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock, camera }) => {
    // The plane follows the camera so the horizon never shows its edge (the shader uses world coordinates).
    mesh.current?.position.set(camera.position.x, -1, camera.position.z);
    // Low quality drops the ambient drift entirely.
    material.uniforms.uTime!.value = quality === 'low' ? 0 : clock.elapsedTime * (reducedMotion ? 0.25 : 1);
  });

  return (
    <mesh ref={mesh} position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1000} frustumCulled={false}>
      <planeGeometry args={[SKY_SIZE, SKY_SIZE]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
