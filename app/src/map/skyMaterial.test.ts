import { describe, expect, it } from 'vitest';
import { advanceSkyTime, applySkyQuality, buildSkyMaterial, skyFragment } from './Sky.tsx';

describe('Sky material', () => {
  it('embeds the grade constants and one shader for every quality', () => {
    const src = skyFragment();
    expect(src).toContain('0.170');
    expect(src).toContain('0.640');
    expect(src).toContain('0.850');
    expect(src).toContain('#define MAX_OCTAVES 5');
    expect(src).toContain('uniform int uOctaves');
  });
  it('builds a material with 64-slot uniforms', () => {
    const m = buildSkyMaterial();
    expect(m.uniforms.uCentres!.value.length).toBe(128);
    expect(m.uniforms.uColours!.value.length).toBe(192);
  });
  it('switches quality in place: same material, same program source, octave uniform toggled', () => {
    const m = buildSkyMaterial();
    const frag = m.fragmentShader;
    applySkyQuality(m, 'low');
    expect(m.uniforms.uOctaves!.value).toBe(2);
    applySkyQuality(m, 'high');
    expect(m.uniforms.uOctaves!.value).toBe(5);
    expect(m.fragmentShader).toBe(frag);
  });
  it('freezes the sky clock at low quality and resumes from the same value; long gaps are capped', () => {
    let t = advanceSkyTime(0, 0.016, 'high', false);
    expect(t).toBeCloseTo(0.016);
    const frozen = advanceSkyTime(t, 0.016, 'low', false);
    expect(frozen).toBe(t);
    t = advanceSkyTime(frozen, 60, 'high', false);
    expect(t).toBeCloseTo(0.016 + 0.1);
    expect(advanceSkyTime(0, 0.1, 'high', true)).toBeCloseTo(0.025);
  });
});
