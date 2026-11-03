import { describe, expect, it } from 'vitest';
import { buildSkyMaterial, skyFragment } from './Sky.tsx';

describe('Sky material', () => {
  it('embeds the grade constants', () => {
    const src = skyFragment('high');
    expect(src).toContain('0.170');
    expect(src).toContain('0.640');
    expect(src).toContain('0.850');
    expect(src).toContain('#define OCTAVES 5');
    expect(skyFragment('low')).toContain('#define OCTAVES 2');
  });
  it('builds a material with 64-slot uniforms', () => {
    const m = buildSkyMaterial('high');
    expect(m.uniforms.uCentres!.value.length).toBe(128);
    expect(m.uniforms.uColours!.value.length).toBe(192);
  });
});
