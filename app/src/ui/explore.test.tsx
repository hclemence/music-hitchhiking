import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { nextEncounter } from '@core/encounters.ts';
import sampleMapJson from '../../../data/sample-map.json';
import type { SampleMap } from '../../../scripts/sample-map.ts';
import { createDemoBackend } from '../backend/demo.ts';
import { BackendError, type Backend } from '../backend/types.ts';
import { createActionQueue } from '../backend/retry.ts';
import { ARRIVAL_DELAY_MS, FLY_IN_MS, MAX_PARKED, WAIT_DRIFT_MS } from '../state/encounterFlow.ts';
import { Explore, type Screen } from './Explore.tsx';
import { ENCOUNTER_TITLE, NOBODY_LEFT } from './EncounterPopup.tsx';
import { Shell } from './Shell.tsx';

type StubProps = {
  stars: { id: string }[];
  currentSongId: string;
  hereDocks?: { id: string; songId: string }[];
  parked: { dock: { id: string } }[];
  arriving: { dockId: string; startedAt: number } | null;
};
const scene = vi.hoisted(() => ({ props: null as null | StubProps }));

vi.mock('../backend/retry.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('../backend/retry.ts')>();
  return { ...m, createActionQueue: vi.fn(m.createActionQueue) };
});

// WebGL is unavailable in jsdom: a stub that renders every star's ships, the ships docked here,
// the parked encounters and the visited stars as buttons, and lands every flight immediately.
vi.mock('../map/MapScene.tsx', async () => {
  const { useEffect } = await import('react');
  type P = StubProps & {
    docks: { id: string; songId: string }[];
    routeHops: { songId: string }[];
    flight: unknown;
    onShipTap?: (id: string) => void;
    onVisitedTap?: (songId: string) => void;
    onFlightEnd?: () => void;
  };
  function MapScene(p: P) {
    scene.props = p;
    useEffect(() => { if (p.flight) p.onFlightEnd?.(); }, [p.flight]);
    return (
      <div data-testid="map" data-current={p.currentSongId}>
        {[...new Map(p.docks.map((d) => [d.songId, d])).values()].map((d) => (
          <button key={d.id} aria-label={`ship ${d.songId}`} onClick={() => p.onShipTap?.(d.id)} />
        ))}
        {(p.hereDocks ?? []).map((d) => (
          <button key={d.id} aria-label={`ship here ${d.id}`} onClick={() => p.onShipTap?.(d.id)} />
        ))}
        {p.parked.map((e) => (
          <button key={e.dock.id} aria-label={`parked ${e.dock.id}`} onClick={() => p.onShipTap?.(e.dock.id)} />
        ))}
        {[...new Set(p.routeHops.map((h) => h.songId))].map((id) => (
          <button key={id} aria-label={`visited ${id}`} onClick={() => p.onVisitedTap?.(id)} />
        ))}
      </div>
    );
  }
  return { MapScene };
});

vi.mock('../map/ShipPreview.tsx', () => ({ ShipPreview: () => null }));
vi.mock('./ShipBadge.tsx', () => ({
  ShipBadge: ({ colour }: { colour: string }) => <span data-testid="ship-badge" data-colour={colour} />,
}));

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const sample = sampleMapJson as SampleMap;
const TZ = 'Europe/London';
const HOME = sample.songs[0]!;
const songById = new Map(sample.songs.map((s) => [s.id, s]));
let storage: MemoryStorage;
let onNavigate: Mock<(screen: Screen) => void>;

// The encounter flow runs on timers and the wall clock: every test here drives a fake clock.
// RTL's async helpers (findBy*, waitFor, userEvent) wait on setTimeout, so they are not used.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  storage = new MemoryStorage();
  localStorage.clear();
  onNavigate = vi.fn();
  scene.props = null;
  vi.mocked(createActionQueue).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const demo = (m: SampleMap = sample) => createDemoBackend(m, storage);

/** Lets pending promises and effects settle without moving the clock. */
async function settle() {
  for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(0));
}
async function tick(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  await settle();
}
async function click(el: Element) {
  fireEvent.click(el);
  await settle();
}
async function type(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
  await tick(300); // past the search debounce
  await settle();
}

async function open(backend: Backend, opts: { start?: boolean; reveal?: boolean } = {}) {
  await backend.setHome(HOME.id);
  if (opts.start !== false) await backend.startJourney(TZ, HOME.id);
  render(<Explore backend={backend} tz={TZ} onNavigate={onNavigate} />);
  await settle();
  if (opts.reveal !== false && opts.start !== false) await reveal();
}
/** The pause after arriving: the first encounter is revealed. */
const reveal = () => tick(ARRIVAL_DELAY_MS);
const queryPopup = () => screen.queryByRole('dialog', { name: ENCOUNTER_TITLE });
const popup = () => screen.getByRole('dialog', { name: ENCOUNTER_TITLE });
const popupDock = () => popup().getAttribute('data-dock-id')!;
const button = (name: string, root: HTMLElement = popup()) => within(root).getByRole('button', { name });
const hitchhike = () => click(button('Hitchhike'));
const wait = () => click(screen.getByRole('button', { name: 'Wait' }));
const parkedIds = () => scene.props!.parked.map((e) => e.dock.id);
const cards = () => screen.queryAllByRole('article');
const here = () => screen.getByLabelText('You are here');
const miniMap = () => screen.getByRole('button', { name: /Route map/ });
const routeSheet = () => screen.getByRole('dialog', { name: 'Your route today' });
const nodeCount = () => miniMap().querySelectorAll('[data-node]').length;
const dashedCount = () => miniMap().querySelectorAll('[data-dashed="true"]').length;
const titleOf = (el: HTMLElement) => el.querySelector('h3')!.textContent!;
const songOf = (el: HTMLElement) => {
  const artist = el.querySelector('.artist')!.textContent!;
  return sample.songs.find((s) => s.title === titleOf(el) && s.artist === artist)!;
};
const popupTitle = () => titleOf(popup());

/** What the core picks next at `at` given today's path and the docks met there. */
async function expectedNext(backend: Backend, at: string, path: string[], met: string[] = []) {
  const m = await backend.loadMap();
  const stars = new Map(m.stars.map((s) => [s.id, s]));
  return nextEncounter({
    current: stars.get(at)!, stars, docks: m.docks, ownDockId: (await backend.getMyDock())?.id ?? null,
    pathSongIds: new Set(path), metDockIds: new Set(met),
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const setVisibility = (v: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
const becomeVisible = async () => {
  setVisibility('visible');
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await settle();
};

describe('Explore encounters', () => {
  it('reveals nothing for 1500 ms, then the nearest ship flies over and the pop-up opens', async () => {
    const backend = demo();
    await open(backend, { reveal: false });
    const nearest = (await expectedNext(backend, HOME.id, [HOME.id]))!;
    await tick(ARRIVAL_DELAY_MS - 1);
    expect(queryPopup()).not.toBeInTheDocument();
    expect(parkedIds()).toEqual([]);
    await tick(1);
    expect(popupDock()).toBe(nearest.dock.id);
    expect(popupTitle()).toBe(songById.get(nearest.songId)!.title);
    expect(within(popup()).getByText('Sample')).toBeInTheDocument();
    expect(scene.props!.arriving?.dockId).toBe(nearest.dock.id);
    expect(parkedIds()).toEqual([nearest.dock.id]);
    await tick(FLY_IN_MS);
    expect(scene.props!.arriving).toBeNull();
    expect(parkedIds()).toEqual([nearest.dock.id]);
    expect(popupDock()).toBe(nearest.dock.id);
  });

  it('Wait reveals the next-nearest after 800 ms and the first stays parked', async () => {
    const backend = demo();
    await open(backend);
    await tick(FLY_IN_MS);
    const first = popupDock();
    const second = (await expectedNext(backend, HOME.id, [HOME.id], [first]))!;
    await wait();
    await tick(WAIT_DRIFT_MS - 1);
    expect(popupDock()).toBe(first);
    await tick(1);
    expect(popupDock()).toBe(second.dock.id);
    expect(parkedIds()).toEqual([first, second.dock.id]);
    expect(scene.props!.arriving?.dockId).toBe(second.dock.id);
  });

  it('closing the pop-up leaves the ship parked; tapping it reopens the pop-up', async () => {
    await open(demo());
    const first = popupDock();
    await click(button('Close'));
    expect(queryPopup()).not.toBeInTheDocument();
    expect(parkedIds()).toEqual([first]);
    await click(screen.getByRole('button', { name: `parked ${first}` }));
    expect(popupDock()).toBe(first);
  });

  it('tapping a ship that is neither parked nor docked here does nothing', async () => {
    await open(demo());
    const first = popupDock();
    await click(button('Close'));
    const other = sample.docks.find((d) => d.id !== first && d.songId !== HOME.id)!;
    await click(screen.getByRole('button', { name: `ship ${other.songId}` }));
    expect(queryPopup()).not.toBeInTheDocument();
    expect(cards()).toHaveLength(0);
  });

  it('says nobody is left once every candidate has been met', async () => {
    const docks = sample.docks.filter((d) => d.songId !== HOME.id).slice(0, 2);
    await open(demo({ ...sample, docks }));
    const first = popupDock();
    await wait();
    await tick(WAIT_DRIFT_MS);
    expect(popupDock()).not.toBe(first);
    await wait();
    await tick(WAIT_DRIFT_MS);
    expect(queryPopup()).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: NOBODY_LEFT });
    expect(dialog).toHaveTextContent(NOBODY_LEFT);
    expect(parkedIds()).toHaveLength(2);
    await click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(NOBODY_LEFT)).not.toBeInTheDocument();
  });

  it('says nobody is nearby when nobody is docked anywhere', async () => {
    await open(demo({ ...sample, docks: [] }));
    expect(screen.getByRole('dialog', { name: NOBODY_LEFT })).toBeInTheDocument();
    expect(parkedIds()).toEqual([]);
  });

  it('hitchhiking during a pending reveal shows only the new stop\'s encounter (RF2)', async () => {
    const base = demo();
    let gate: Promise<void> | null = null;
    const backend: Backend = { ...base, async hop(...a) { if (gate) await gate; return base.hop(...a); } };
    await open(backend);
    const target = songOf(popup());
    await wait(); // a reveal for this stop is now due in 800 ms
    const d = deferred();
    gate = d.promise;
    await hitchhike();
    expect(here()).toHaveTextContent(target.title);
    await tick(WAIT_DRIFT_MS + ARRIVAL_DELAY_MS); // the old stop's reveal time passes while the hop is pending
    expect(queryPopup()).not.toBeInTheDocument();
    expect(parkedIds()).toEqual([]);
    await act(async () => { d.resolve(); await d.promise; });
    await settle();
    expect(queryPopup()).not.toBeInTheDocument();
    await tick(ARRIVAL_DELAY_MS);
    const expected = (await expectedNext(backend, target.id, [HOME.id, target.id]))!;
    expect(popupDock()).toBe(expected.dock.id);
    expect(parkedIds()).toEqual([expected.dock.id]);
  });

  it('a hidden tab reveals exactly once when it is shown again (RF1)', async () => {
    const base = demo();
    let loadGate: Promise<void> | null = null;
    // The reload that coming back starts never lands, so only the visibility check can reveal.
    const backend: Backend = { ...base, async loadMap() { if (loadGate) await loadGate; return base.loadMap(); } };
    await open(backend, { reveal: false });
    const nearest = (await expectedNext(base, HOME.id, [HOME.id]))!;
    loadGate = new Promise(() => {});
    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    vi.setSystemTime(Date.now() + 10_000); // time passes but the throttled timer has not fired
    await settle();
    expect(queryPopup()).not.toBeInTheDocument();
    await becomeVisible();
    expect(popupDock()).toBe(nearest.dock.id);
    expect(parkedIds()).toEqual([nearest.dock.id]);
    await tick(ARRIVAL_DELAY_MS + FLY_IN_MS); // the throttled timer fires late: nothing more
    expect(popupDock()).toBe(nearest.dock.id);
    expect(parkedIds()).toEqual([nearest.dock.id]);
  });

  it('a reveal that falls due while a hop is pending, which then fails, is made where you are', async () => {
    const base = demo();
    const d = deferred();
    const backend: Backend = {
      ...base,
      async hop() { await d.promise; throw new BackendError('unknown_song'); },
    };
    await open(backend);
    const first = popupDock();
    await wait();
    await hitchhike();
    await tick(WAIT_DRIFT_MS * 2); // the Wait reveal falls due while the hop is pending
    expect(queryPopup()).not.toBeInTheDocument();
    await act(async () => { d.resolve(); await d.promise.catch(() => {}); });
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't/i);
    expect(here()).toHaveTextContent(HOME.title);
    const second = (await expectedNext(base, HOME.id, [HOME.id], [first]))!;
    expect(popupDock()).toBe(second.dock.id);
    expect(parkedIds()).toEqual([first, second.dock.id]);
  });

  it('five Waits leave exactly 4 parked, the oldest returned to their stars (RF3)', async () => {
    await open(demo());
    const seen = [popupDock()];
    for (let i = 0; i < 5; i++) {
      await wait();
      await tick(WAIT_DRIFT_MS);
      seen.push(popupDock());
    }
    expect(new Set(seen).size).toBe(6);
    expect(parkedIds()).toHaveLength(MAX_PARKED);
    expect(parkedIds()).toEqual(seen.slice(-MAX_PARKED));
  });

  it('a reload of the same journey does not restart the stop', async () => {
    await open(demo());
    await wait();
    await tick(WAIT_DRIFT_MS);
    const parked = parkedIds();
    await becomeVisible(); // reloads the map and journey
    await tick(ARRIVAL_DELAY_MS);
    expect(parkedIds()).toEqual(parked);
  });

  it('moving back to an earlier stop starts its encounters again without those already met there', async () => {
    const backend = demo();
    await open(backend);
    const metAtHome = popupDock();
    await hitchhike();
    await reveal();
    fireEvent.click(miniMap());
    await click(within(routeSheet()).getByRole('button', { name: `Go back to ${HOME.title} by ${HOME.artist}` }));
    expect(queryPopup()).not.toBeInTheDocument();
    expect(parkedIds()).toEqual([]);
    await reveal();
    const j = (await backend.currentJourney(TZ))!;
    const expected = (await expectedNext(backend, HOME.id, j.hops.map((h) => h.songId), [metAtHome]))!;
    expect(popupDock()).toBe(expected.dock.id);
  });

  it('tapping the star you are at does not move you to a later hop at the same song', async () => {
    const backend = demo();
    await open(backend);
    await hitchhike();
    await reveal();
    await click(screen.getByRole('button', { name: 'Home' })); // a second hop at HOME
    await reveal();
    fireEvent.click(miniMap());
    const stops = within(routeSheet()).getAllByRole('button', { name: `Go back to ${HOME.title} by ${HOME.artist}` });
    expect(stops).toHaveLength(1);
    await click(stops[0]!); // the root hop
    const root = (await backend.currentJourney(TZ))!.currentHopId;
    await click(screen.getByRole('button', { name: `visited ${HOME.id}` }));
    expect((await backend.currentJourney(TZ))!.currentHopId).toBe(root);
  });
});

describe('Explore', () => {
  it('offers a start choice when there is no journey today and starts at a searched song', async () => {
    const backend = demo();
    await open(backend, { start: false });
    expect(screen.getByRole('button', { name: 'Start from home' })).toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'Start somewhere else' }));
    await type(screen.getByRole('searchbox'), 'Bohemian');
    await click(screen.getByRole('button', { name: /Bohemian Rhapsody/ }));
    expect(here()).toHaveTextContent('Bohemian Rhapsody');
    const j = await backend.currentJourney(TZ);
    expect(songById.get(j!.hops[0]!.songId)!.title).toBe('Bohemian Rhapsody');
    await reveal();
    expect(popup()).toBeInTheDocument();
  });

  it('starts from home with one tap', async () => {
    await open(demo(), { start: false });
    await click(screen.getByRole('button', { name: 'Start from home' }));
    expect(here()).toHaveTextContent(HOME.title);
    expect(nodeCount()).toBe(1);
    await reveal();
    expect(popup()).toBeInTheDocument();
  });

  it('hitchhiking from the pop-up adds one node to the mini-map and changes the current song', async () => {
    await open(demo());
    const title = popupTitle();
    await hitchhike();
    expect(here()).toHaveTextContent(title);
    expect(nodeCount()).toBe(2);
    await reveal();
    expect(popupTitle()).not.toBe(title);
  });

  it('Home is a jump drawn as a dashed edge', async () => {
    await open(demo());
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    await hitchhike();
    expect(dashedCount()).toBe(0);
    await click(screen.getByRole('button', { name: 'Home' }));
    expect(here()).toHaveTextContent(HOME.title);
    expect(nodeCount()).toBe(3);
    expect(dashedCount()).toBe(1);
  });

  it('tapping the root node then hitchhiking makes a branch', async () => {
    const backend = demo();
    await open(backend);
    await hitchhike();
    fireEvent.click(miniMap());
    await click(within(routeSheet()).getByRole('button', { name: `Go back to ${HOME.title} by ${HOME.artist}` }));
    expect(screen.queryByRole('dialog', { name: 'Your route today' })).not.toBeInTheDocument();
    expect(here()).toHaveTextContent(HOME.title);
    await reveal();
    await hitchhike();
    expect(nodeCount()).toBe(3);
    const j = (await backend.currentJourney(TZ))!;
    const root = j.hops.find((h) => h.parentHopId === null)!;
    expect(j.hops.filter((h) => h.parentHopId === root.id)).toHaveLength(2);
  });

  it('recovers from bad_hop after the day rolled over by starting a journey where you are', async () => {
    const base = demo();
    let tripped = false;
    const backend: Backend = {
      ...base,
      async hop(...args) {
        if (!tripped) {
          tripped = true;
          storage.removeItem('mh.demo.journeys'); // a new day: yesterday's hops are gone
          throw new BackendError('bad_hop');
        }
        return base.hop(...args);
      },
    };
    await open(backend);
    const title = popupTitle();
    await hitchhike();
    expect(here()).toHaveTextContent(title);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const j = (await backend.currentJourney(TZ))!;
    expect(j.hops).toHaveLength(2);
    expect(j.hops[0]!.songId).toBe(HOME.id);
    expect(songById.get(j.hops[1]!.songId)!.title).toBe(title);
    expect(nodeCount()).toBe(2);
    await reveal();
    expect(popupTitle()).not.toBe(title);
  });

  it('recovers from bad_hop when startJourney reports journey_exists', async () => {
    const base = demo();
    let tripped = false;
    const backend: Backend = {
      ...base,
      async hop(...args) {
        if (!tripped) { tripped = true; throw new BackendError('bad_hop'); }
        return base.hop(...args);
      },
    };
    await open(backend);
    const title = popupTitle();
    await hitchhike();
    expect(here()).toHaveTextContent(title);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
    expect(nodeCount()).toBe(2);
  });

  it('keeps the hop while offline, shows the banner and ends with exactly one new hop', async () => {
    const base = demo();
    let offline = false;
    let hopCalls = 0;
    const net = () => { if (offline) throw new BackendError('network'); };
    const backend: Backend = {
      ...base,
      async hop(...args) { hopCalls++; net(); return base.hop(...args); },
      async currentJourney(tz) { net(); return base.currentJourney(tz); },
    };
    await open(backend);
    const title = popupTitle();
    offline = true;
    await hitchhike();
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(here()).toHaveTextContent(title);
    expect(nodeCount()).toBe(2);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    expect(queryPopup()).not.toBeInTheDocument(); // nothing is revealed while the hop is pending
    await tick(1000);
    await tick(2000);
    expect(hopCalls).toBe(1); // retries look for the hop before sending it again
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(queryPopup()).not.toBeInTheDocument();
    offline = false;
    await tick(4000);
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(nodeCount()).toBe(2);
    expect(here()).toHaveTextContent(title);
    const j = (await backend.currentJourney(TZ))!;
    expect(j.hops).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await reveal();
    expect(popupTitle()).not.toBe(title);
  });

  it('does not send the hop twice when the first response was lost', async () => {
    const base = demo();
    let lose = true;
    let hopCalls = 0;
    const backend: Backend = {
      ...base,
      async hop(...args) {
        hopCalls++;
        const h = await base.hop(...args);
        if (lose) { lose = false; throw new BackendError('network'); }
        return h;
      },
    };
    await open(backend);
    await hitchhike();
    await tick(1000);
    expect(hopCalls).toBe(1);
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
    expect(nodeCount()).toBe(2);
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('rolls a rejected hop back with a message and the pop-up comes back', async () => {
    const base = demo();
    const backend: Backend = { ...base, hop: async () => { throw new BackendError('unknown_song'); } };
    await open(backend);
    const dock = popupDock();
    await hitchhike();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't/i);
    expect(here()).toHaveTextContent(HOME.title);
    expect(nodeCount()).toBe(1);
    expect(popupDock()).toBe(dock);
  });

  it('Hitchhike in the pop-up is optimistic: you move before the server answers', async () => {
    const base = demo();
    const d = deferred();
    const backend: Backend = { ...base, async hop(...a) { await d.promise; return base.hop(...a); } };
    await open(backend);
    const title = popupTitle();
    await hitchhike();
    expect(here()).toHaveTextContent(title);
    expect(nodeCount()).toBe(2);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    await act(async () => { d.resolve(); await d.promise; });
    await settle();
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled();
  });

  it('streaming buttons link to the song in a new tab', async () => {
    await open(demo());
    const song = songOf(popup());
    const links = within(popup()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Spotify', 'Apple Music', 'YouTube']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([song.spotifyUrl, song.appleUrl, song.youtubeUrl]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('the pop-up shows the Sample label and the ship; Like keeps the song (trace) and turns into Kept', async () => {
    const base = demo();
    const liked: string[] = [];
    const backend: Backend = { ...base, likeDock: async (id) => { liked.push(id); return null; } };
    await open(backend);
    expect(within(popup()).getByText('Sample')).toBeInTheDocument();
    const dockId = popupDock();
    const dock = sample.docks.find((d) => d.id === dockId)!;
    // The colour dot while the ship flies in, then its thumbnail once it has landed.
    expect(within(popup()).queryByTestId('ship-badge')).not.toBeInTheDocument();
    expect(popup().querySelector('.ship-dot')).toHaveStyle({ backgroundColor: dock.shipColour });
    await tick(FLY_IN_MS);
    expect(within(popup()).getByTestId('ship-badge')).toHaveAttribute('data-colour', dock.shipColour);
    await click(button('Like'));
    expect(button('Kept')).toBeDisabled();
    await tick(0);
    expect(liked).toEqual([dockId]);
    // Still kept when the pop-up is reopened from the parked ship.
    await click(button('Close'));
    await click(screen.getByRole('button', { name: `parked ${dockId}` }));
    expect(button('Kept')).toBeDisabled();
  });

  it('shows "+N others here" when more ships are docked at the song', async () => {
    const extra = sample.docks.flatMap((d, i) => [d, { ...d, id: `extra-${i}-a` }, { ...d, id: `extra-${i}-b` }]);
    await open(demo({ ...sample, docks: extra }));
    const songId = songOf(popup()).id;
    const others = extra.filter((d) => d.songId === songId).length - 1;
    expect(others).toBeGreaterThanOrEqual(2);
    expect(within(popup()).getByText(`+${others} others here`)).toBeInTheDocument();
  });

  it('draws other ships docked at the current star (not your own); tapping one shows Like and links, no Hitchhike', async () => {
    const backend = demo();
    const at = sample.docks[0]!.songId;
    const theirs = sample.docks.filter((d) => d.songId === at).map((d) => d.id);
    const own = await backend.setDock(at);
    await backend.setHome(at);
    await backend.startJourney(TZ, at);
    render(<Explore backend={backend} tz={TZ} onNavigate={onNavigate} />);
    await settle();
    await reveal();
    expect(scene.props!.currentSongId).toBe(at);
    expect(scene.props!.hereDocks!.map((d) => d.id).sort()).toEqual([...theirs].sort());
    expect(screen.queryByRole('button', { name: `ship here ${own}` })).not.toBeInTheDocument();
    expect(theirs).not.toContain(popupDock());
    const met = popupDock();

    await click(screen.getByRole('button', { name: `ship here ${theirs[0]}` }));
    expect(queryPopup()).not.toBeInTheDocument();
    const region = screen.getByLabelText('Docked here');
    const card = within(region).getByRole('article');
    expect(card).toHaveAttribute('data-dock-id', theirs[0]);
    expect(within(card).getByRole('heading')).toHaveTextContent(songById.get(at)!.title);
    expect(within(card).getByText('Sample')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Spotify' })).toHaveAttribute('href', songById.get(at)!.spotifyUrl);
    expect(within(card).queryByRole('button', { name: 'Hitchhike' })).not.toBeInTheDocument();
    await click(within(card).getByRole('button', { name: 'Like' }));
    expect(within(card).getByRole('button', { name: 'Kept' })).toBeDisabled();
    await click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Docked here')).not.toBeInTheDocument();
    expect(parkedIds()).toEqual([met]);
    await click(screen.getByRole('button', { name: `parked ${met}` }));
    expect(popupDock()).toBe(met);
  });

  it('after hitchhiking, the ship you flew alongside is drawn at the star you landed on', async () => {
    await open(demo());
    const dockId = popupDock();
    await hitchhike();
    expect(scene.props!.hereDocks!.map((d) => d.id)).toContain(dockId);
    expect(parkedIds()).not.toContain(dockId);
  });

  it('hides History and Inbox in demo mode; Ship and Dock navigate', async () => {
    await open(demo());
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Inbox/ })).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'Ship' }));
    await click(screen.getByRole('button', { name: 'Dock' }));
    expect(onNavigate.mock.calls).toEqual([['ship'], ['dock']]);
  });

  it('shows History and Inbox (with a dot for unseen items) in live mode', async () => {
    const base = demo();
    const backend: Backend = {
      ...base,
      mode: 'live',
      getInbox: async () => [{
        id: 'i1', kind: 'suggestion', songId: HOME.id, title: HOME.title, artist: HOME.artist,
        shipColour: null, replyTraceId: null, createdAt: '2026-11-03T10:00:00Z', seenAt: null,
      }],
    };
    await open(backend);
    await click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('button', { name: 'Inbox (new)' })).toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'Inbox (new)' }));
    expect(onNavigate.mock.calls).toEqual([['history'], ['inbox']]);
  });
});

describe('Explore path exclusion', () => {
  it('never shows a song already on today\'s path', async () => {
    const backend = demo();
    await open(backend);
    const check = async () => {
      const j = (await backend.currentJourney(TZ))!;
      const path = new Set(j.hops.map((h) => h.songId));
      expect(path.has(songOf(popup()).id)).toBe(false);
    };
    await check();
    await hitchhike();
    await reveal();
    await check();
    fireEvent.click(miniMap());
    await click(within(routeSheet()).getAllByRole('button', { name: /^Go back to/ })[0]!);
    await reveal();
    await check();
    await hitchhike();
    await reveal();
    await check();
    await click(screen.getByRole('button', { name: 'Home' }));
    await reveal();
    await check();
  });
});

describe('Explore review fixes', () => {
  it('a reload that started mid-hop and lands after the confirm does not drop the hop', async () => {
    const base = demo();
    let loadGate: Promise<void> | null = null;
    let hopGate: Promise<void> | null = null;
    const backend: Backend = {
      ...base,
      async loadMap() { if (loadGate) await loadGate; return base.loadMap(); },
      async hop(...a) { if (hopGate) await hopGate; return base.hop(...a); },
    };
    await open(backend);
    const title = popupTitle();
    const hopD = deferred();
    hopGate = hopD.promise;
    await hitchhike();
    const loadD = deferred();
    loadGate = loadD.promise;
    await becomeVisible(); // reload starts now: currentJourney answers without the new hop
    await act(async () => { hopD.resolve(); await hopD.promise; });
    await settle();
    expect(nodeCount()).toBe(2);
    await act(async () => { loadD.resolve(); await loadD.promise; });
    await settle();
    expect(nodeCount()).toBe(2);
    expect(here()).toHaveTextContent(title);
  });

  it('a reload that started before a move settled does not undo the move', async () => {
    const base = demo();
    let loadGate: Promise<void> | null = null;
    let moveGate: Promise<void> | null = null;
    const backend: Backend = {
      ...base,
      async loadMap() { if (loadGate) await loadGate; return base.loadMap(); },
      async moveTo(...a) { if (moveGate) await moveGate; return base.moveTo(...a); },
    };
    await open(backend);
    await hitchhike();
    const moveD = deferred();
    moveGate = moveD.promise;
    fireEvent.click(miniMap());
    await click(screen.getByRole('button', { name: `Go back to ${HOME.title} by ${HOME.artist}` }));
    const loadD = deferred();
    loadGate = loadD.promise;
    await becomeVisible();
    await act(async () => { moveD.resolve(); await moveD.promise; });
    await settle();
    await act(async () => { loadD.resolve(); await loadD.promise; });
    await settle();
    expect(here()).toHaveTextContent(HOME.title);
  });

  it('after the day rolls over a reload keeps the map; the next hitchhike starts today\'s journey (Ruling 9)', async () => {
    const base = demo();
    let journeyReads = 0;
    const backend: Backend = { ...base, async currentJourney(tz) { journeyReads++; return base.currentJourney(tz); } };
    await open(backend);
    const shown = popupDock();
    storage.removeItem('mh.demo.journeys'); // 4am: today has no journey yet
    const reads = journeyReads;
    await becomeVisible();
    expect(journeyReads).toBeGreaterThan(reads);
    expect(screen.queryByText('Where do you want to start today?')).not.toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(popupDock()).toBe(shown);
    expect(here()).toHaveTextContent(HOME.title);

    const target = songOf(popup());
    await hitchhike();
    expect(here()).toHaveTextContent(target.title);
    expect((await base.currentJourney(TZ))?.hops).toHaveLength(2);
    const j = (await base.currentJourney(TZ))!;
    expect(j.hops[0]!.songId).toBe(HOME.id);
    expect(j.hops[1]!.songId).toBe(target.id);
    expect(Object.keys(JSON.parse(storage.getItem('mh.demo.journeys')!))).toHaveLength(1); // one new journey
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(nodeCount()).toBe(2);
  });

  it('shows the start picker when no journey has been shown yet', async () => {
    await open(demo(), { start: false });
    expect(screen.getByText('Where do you want to start today?')).toBeInTheDocument();
    await becomeVisible();
    expect(screen.getByText('Where do you want to start today?')).toBeInTheDocument();
  });

  it('fetches a current song that is not a star and gives it to the map', async () => {
    const base = demo();
    const asked: string[][] = [];
    const backend: Backend = {
      ...base,
      async loadMap() {
        const m = await base.loadMap();
        return { ...m, stars: m.stars.filter((s) => s.id !== HOME.id) };
      },
      async getSongs(ids) { asked.push(ids); return base.getSongs(ids); },
    };
    await open(backend);
    expect(popup()).toBeInTheDocument();
    expect(asked).toEqual([[HOME.id]]);
    expect(here()).toHaveTextContent(HOME.title);
    expect(scene.props!.currentSongId).toBe(HOME.id);
    expect(scene.props!.stars.some((s) => s.id === HOME.id)).toBe(true);
  });

  it('retries fetching the current song while offline', async () => {
    const base = demo();
    let fails = 1;
    const backend: Backend = {
      ...base,
      async loadMap() {
        const m = await base.loadMap();
        return { ...m, stars: m.stars.filter((s) => s.id !== HOME.id) };
      },
      async getSongs(ids) {
        if (fails-- > 0) throw new BackendError('network');
        return base.getSongs(ids);
      },
    };
    await open(backend, { reveal: false });
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    await tick(1000);
    expect(here()).toHaveTextContent(HOME.title);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await reveal();
    expect(popup()).toBeInTheDocument();
  });

  it('recovers from bad_hop on a later attempt (offline across the day change)', async () => {
    const base = demo();
    let calls = 0;
    const backend: Backend = {
      ...base,
      async hop(...a) {
        calls++;
        if (calls === 1) throw new BackendError('network');
        if (calls === 2) { storage.removeItem('mh.demo.journeys'); throw new BackendError('bad_hop'); }
        return base.hop(...a);
      },
    };
    await open(backend);
    const title = popupTitle();
    await hitchhike();
    await tick(1000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(here()).toHaveTextContent(title);
    const j = (await backend.currentJourney(TZ))!;
    expect(j.hops.map((h) => h.kind)).toEqual(['start', 'hitchhike']);
    expect(nodeCount()).toBe(2);
  });

  it('a network error while recovering from bad_hop goes offline and retries', async () => {
    const base = demo();
    let tripped = false;
    let startFails = 0;
    const backend: Backend = {
      ...base,
      async hop(...a) {
        if (!tripped) { tripped = true; storage.removeItem('mh.demo.journeys'); throw new BackendError('bad_hop'); }
        return base.hop(...a);
      },
      async startJourney(tz, songId) {
        if (startFails-- > 0) throw new BackendError('network');
        return base.startJourney(tz, songId);
      },
    };
    await open(backend);
    const title = popupTitle();
    startFails = 1;
    await hitchhike();
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await tick(1000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(here()).toHaveTextContent(title);
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
  });

  it('a like the server rejects is no longer shown as Kept', async () => {
    const base = demo();
    const backend: Backend = { ...base, likeDock: async () => { throw new BackendError('unknown_dock'); } };
    await open(backend);
    await click(button('Like'));
    await tick(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't keep/i);
    expect(button('Like')).toBeEnabled();
  });

  it('disposes its action queue on unmount', async () => {
    const backend = demo();
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    const { unmount } = render(<Explore backend={backend} tz={TZ} onNavigate={onNavigate} />);
    await settle();
    expect(createActionQueue).toHaveBeenCalledTimes(1);
    const q = vi.mocked(createActionQueue).mock.results[0]!.value as ReturnType<typeof createActionQueue>;
    const dispose = vi.spyOn(q, 'dispose');
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('Shell', () => {
  it('Ship opens over the map; a pending offline hop survives and confirms later; one queue only', async () => {
    const base = demo();
    let offline = false;
    const net = () => { if (offline) throw new BackendError('network'); };
    const backend: Backend = {
      ...base,
      async hop(...a) { net(); return base.hop(...a); },
      async currentJourney(tz) { net(); return base.currentJourney(tz); },
    };
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    render(<Shell backend={backend} tz={TZ} />);
    await settle();
    await reveal();
    offline = true;
    await hitchhike();
    await click(screen.getByRole('button', { name: 'Ship' }));
    const sheet = screen.getByRole('dialog', { name: 'Ship' });
    expect(screen.getByLabelText('You are here')).toBeInTheDocument(); // the map stays underneath
    await tick(1000);
    await click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(nodeCount()).toBe(2);
    offline = false;
    await tick(2000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
    expect(nodeCount()).toBe(2);
    expect(createActionQueue).toHaveBeenCalledTimes(1);
  });

  it('Dock saves over the map, closes the sheet and Explore reloads with the new dock', async () => {
    const backend = demo();
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    render(<Shell backend={backend} tz={TZ} />);
    await settle();
    const loads = vi.spyOn(backend, 'loadMap');
    await click(screen.getByRole('button', { name: 'Dock' }));
    const sheet = screen.getByRole('dialog', { name: 'Dock' });
    await type(within(sheet).getByRole('searchbox'), 'the');
    const first = sheet.querySelector('.results button') as HTMLElement;
    expect(first).not.toBeNull();
    const title = first.querySelector('.r-title')!.textContent!;
    const artist = first.querySelector('.r-artist')!.textContent!;
    const chosen = sample.songs.find((x) => x.title === title && x.artist === artist)!;
    await click(first);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await backend.getMyDock())!.songId).toBe(chosen.id);
    expect(loads).toHaveBeenCalled();
  });
});

describe('Shell history and inbox', () => {
  const mk = () => ({
    ...demo(),
    mode: 'live' as const,
    getTraces: vi.fn(async () => [{
      id: 't1', originSongId: HOME.id, originTitle: 'Origin', originArtist: 'Maker', shipColour: '#ff8844', brightness: 0.5,
    }]),
    findTrace: vi.fn(async () => null),
    sendSuggestion: vi.fn(async () => {}),
    getInbox: vi.fn(async () => [{
      id: 'i1', kind: 'suggestion' as const, songId: HOME.id, title: 'Sugg', artist: 'Band',
      shipColour: '#44aaff', replyTraceId: null, createdAt: '2026-11-03T10:00:00Z', seenAt: null,
    }]),
    markInboxSeen: vi.fn(async () => {}),
  }) as unknown as Backend;

  it('opens History and Inbox as sheets; opening the Inbox marks seen and the dot clears on close', async () => {
    const backend = mk();
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    render(<Shell backend={backend} tz={TZ} />);
    await settle();
    await click(screen.getByRole('button', { name: 'Inbox (new)' }));
    expect(screen.getByRole('dialog', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByText('Sugg')).toBeInTheDocument();
    expect(backend.markInboxSeen).toHaveBeenCalledTimes(1);
    (backend.getInbox as Mock).mockImplementation(async () => [{
      id: 'i1', kind: 'suggestion', songId: HOME.id, title: 'Sugg', artist: 'Band',
      shipColour: '#44aaff', replyTraceId: null, createdAt: '2026-11-03T10:00:00Z', seenAt: '2026-11-03T11:00:00Z',
    }]);
    await click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Origin')).toBeInTheDocument();
  });

  it('Visit in the Inbox closes the sheet and hops to that song', async () => {
    const backend = mk();
    const other = sample.songs[5]!;
    (backend.getInbox as Mock).mockImplementation(async () => [{
      id: 'i1', kind: 'suggestion', songId: other.id, title: other.title, artist: other.artist,
      shipColour: '#44aaff', replyTraceId: null, createdAt: '2026-11-03T10:00:00Z', seenAt: null,
    }]);
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    render(<Shell backend={backend} tz={TZ} />);
    await settle();
    await click(screen.getByRole('button', { name: 'Inbox (new)' }));
    await click(screen.getByRole('button', { name: 'Visit' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(scene.props?.currentSongId).toBe(other.id);
  });
});
