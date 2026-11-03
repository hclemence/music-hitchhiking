import { expect, test } from 'vitest';
import { seededRng } from './rng.ts';

test('same seed gives same sequence', () => {
  const a = seededRng('x'), b = seededRng('x');
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test('values in [0,1) and seeds differ', () => {
  const r = seededRng('y');
  const vals = Array.from({ length: 1000 }, r);
  expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
  expect(seededRng('a')()).not.toBe(seededRng('b')());
});
