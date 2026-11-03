import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIP_COLOURS } from './palette.ts';

// set_ship_colour checks against a SQL list; this keeps it from drifting from SHIP_COLOURS.
describe('set_ship_colour migration', () => {
  it('accepts exactly the SHIP_COLOURS', () => {
    const sql = readFileSync(
      new URL('../../../migrations/20261102000700_review_fixes.sql', import.meta.url),
      'utf8',
    );
    const fn = sql.slice(sql.indexOf('function public.set_ship_colour'));
    const list = /array\[([^\]]*)\]/.exec(fn);
    expect(list).not.toBeNull();
    const colours = [...list![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(colours).toHaveLength(12);
    expect(colours).toEqual([...SHIP_COLOURS]);
  });
});
