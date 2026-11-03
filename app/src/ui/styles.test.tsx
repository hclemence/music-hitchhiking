import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EncounterCard } from './EncounterCard.tsx';
import type { ShownEncounter } from '../state/useExplore.ts';

const css = readFileSync(join(import.meta.dirname, '../app.css'), 'utf8');

/** Every value `prop` is given by a stylesheet rule that matches `el` (jsdom does no layout). */
function declared(el: Element, prop: string): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule) || !el.matches(rule.selectorText)) continue;
      const v = rule.style.getPropertyValue(prop);
      if (v) out.push(v);
    }
  }
  return out;
}

// Found by the e2e run: the ship picker's `.swatch` rule (full width, 44px tall) also matched the
// small colour dot on encounter cards, which grew into a wide ellipse and pushed the title out.
describe('app.css', () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  });
  afterEach(() => { cleanup(); style.remove(); });

  it('keeps the encounter card colour dot small (picker swatch styles do not leak)', () => {
    const encounter = {
      songId: 's1', distance: 1, othersCount: 0,
      dock: { id: 'd1', songId: 's1', isSample: false, shipColour: '#e8554e', updatedAt: '2026-11-03T00:00:00Z' },
      song: { id: 's1', title: 'Song', artist: 'Artist', spotifyUrl: '', appleUrl: '', youtubeUrl: '' },
    } as unknown as ShownEncounter;
    render(<EncounterCard encounter={encounter} selected={false} kept={false} disabled={false} onLike={() => {}} onHitchhike={() => {}} />);
    const dot = screen.getByRole('article').querySelector('[data-swatch]') as HTMLElement;
    expect(declared(dot, 'width')).toEqual(['18px']);
    expect(declared(dot, 'height')).toEqual(['18px']);
    expect(declared(dot, 'min-height')).toEqual([]);
  });

  it('still sizes the ship picker swatches as tap targets', () => {
    render(<div className="swatches"><button type="button" className="swatch" aria-label="c" /></div>);
    const swatch = screen.getByRole('button', { name: 'c' });
    expect(declared(swatch, 'width').at(-1)).toBe('100%');
    expect(declared(swatch, 'min-height').at(-1)).toBe('var(--tap)');
  });
});
