import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import sampleMapJson from '../../../data/sample-map.json';
import type { SampleMap } from '../../../scripts/sample-map.ts';
import { createDemoBackend } from '../backend/demo.ts';
import { BackendError, type Backend } from '../backend/types.ts';
import { createActionQueue } from '../backend/retry.ts';
import { Explore, type Screen } from './Explore.tsx';
import { Shell } from './Shell.tsx';

const scene = vi.hoisted(() => ({
  props: null as null | { stars: { id: string }[]; currentSongId: string; hereDocks?: { id: string; songId: string }[] },
}));

vi.mock('../backend/retry.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('../backend/retry.ts')>();
  return { ...m, createActionQueue: vi.fn(m.createActionQueue) };
});

// WebGL is unavailable in jsdom: a stub that renders the encounter ships as buttons and
// lands every flight immediately.
vi.mock('../map/MapScene.tsx', async () => {
  const { useEffect } = await import('react');
  type P = {
    docks: { id: string; songId: string }[];
    encounterSongIds: string[];
    hereDocks?: { id: string; songId: string }[];
    currentSongId: string;
    flight: unknown;
    onShipTap?: (id: string) => void;
    onFlightEnd?: () => void;
  };
  function MapScene(p: P & { stars: { id: string }[] }) {
    scene.props = p;
    useEffect(() => { if (p.flight) p.onFlightEnd?.(); }, [p.flight]);
    return (
      <div data-testid="map" data-current={p.currentSongId}>
        {p.encounterSongIds.map((songId) => {
          const d = p.docks.find((x) => x.songId === songId)!;
          return <button key={d.id} aria-label={`ship ${songId}`} onClick={() => p.onShipTap?.(d.id)} />;
        })}
        {(p.hereDocks ?? []).map((d) => (
          <button key={d.id} aria-label={`ship here ${d.id}`} onClick={() => p.onShipTap?.(d.id)} />
        ))}
      </div>
    );
  }
  return { MapScene };
});

vi.mock('../map/ShipPreview.tsx', () => ({ ShipPreview: () => null }));

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

beforeEach(() => {
  storage = new MemoryStorage();
  localStorage.clear();
  onNavigate = vi.fn();
  scene.props = null;
  vi.mocked(createActionQueue).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const demo = (m: SampleMap = sample) => createDemoBackend(m, storage);

async function open(backend: Backend, opts: { start?: boolean } = {}) {
  await backend.setHome(HOME.id);
  if (opts.start !== false) await backend.startJourney(TZ, HOME.id);
  render(<Explore backend={backend} tz={TZ} onNavigate={onNavigate} />);
}
const cards = () => screen.getAllByRole('article');
const findCards = () => screen.findAllByRole('article');
const dockIdsShown = () => cards().map((c) => c.getAttribute('data-dock-id'));
const here = () => screen.getByLabelText('You are here');
const miniMap = () => screen.getByRole('button', { name: /Route map/ });
const nodeCount = () => miniMap().querySelectorAll('[data-node]').length;
const dashedCount = () => miniMap().querySelectorAll('[data-dashed="true"]').length;
const titleOf = (card: HTMLElement) => card.querySelector('h3')!.textContent!;
const songOf = (card: HTMLElement) => {
  const artist = card.querySelector('.artist')!.textContent!;
  return sample.songs.find((s) => s.title === titleOf(card) && s.artist === artist)!;
};

describe('Explore', () => {
  it('offers a start choice when there is no journey today and starts at a searched song', async () => {
    const backend = demo();
    await open(backend, { start: false });
    expect(await screen.findByRole('button', { name: 'Start from home' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start somewhere else' }));
    await user.type(screen.getByRole('searchbox'), 'Bohemian');
    await user.click(await screen.findByRole('button', { name: /Bohemian Rhapsody/ }));
    await findCards();
    expect(here()).toHaveTextContent('Bohemian Rhapsody');
    const j = await backend.currentJourney(TZ);
    expect(songById.get(j!.hops[0]!.songId)!.title).toBe('Bohemian Rhapsody');
  });

  it('starts from home with one tap', async () => {
    const backend = demo();
    await open(backend, { start: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Start from home' }));
    await findCards();
    expect(here()).toHaveTextContent(HOME.title);
  });

  it('renders three encounter cards', async () => {
    await open(demo());
    expect(await findCards()).toHaveLength(3);
    expect(here()).toHaveTextContent(HOME.title);
    expect(nodeCount()).toBe(1);
  });

  it('hitchhiking adds one node to the mini-map and changes the current song', async () => {
    await open(demo());
    const [first] = await findCards();
    const title = titleOf(first!);
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    expect(here()).toHaveTextContent(title);
    expect(nodeCount()).toBe(2);
    expect(await findCards()).toHaveLength(3);
    expect(cards().map(titleOf)).not.toContain(title);
  });

  it('Wait shows three different docks', async () => {
    await open(demo());
    await findCards();
    const before = dockIdsShown();
    await userEvent.click(screen.getByRole('button', { name: 'Wait' }));
    const after = dockIdsShown();
    expect(after).toHaveLength(3);
    for (const id of after) expect(before).not.toContain(id);
  });

  it('Home is a jump drawn as a dashed edge', async () => {
    await open(demo());
    const [first] = await findCards();
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    expect(dashedCount()).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(here()).toHaveTextContent(HOME.title);
    expect(nodeCount()).toBe(3);
    expect(dashedCount()).toBe(1);
  });

  it('tapping the root node then hitchhiking makes a branch', async () => {
    const backend = demo();
    await open(backend);
    const user = userEvent.setup();
    const [first] = await findCards();
    await user.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await user.click(miniMap());
    const sheet = screen.getByRole('dialog', { name: 'Your route today' });
    await user.click(within(sheet).getByRole('button', { name: `Go back to ${HOME.title} by ${HOME.artist}` }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(here()).toHaveTextContent(HOME.title);
    const [again] = cards();
    await user.click(within(again!).getByRole('button', { name: 'Hitchhike' }));
    expect(nodeCount()).toBe(3);
    const j = (await backend.currentJourney(TZ))!;
    const root = j.hops.find((h) => h.parentHopId === null)!;
    expect(j.hops.filter((h) => h.parentHopId === root.id)).toHaveLength(2);
  });

  it('shows the empty state when nobody is docked nearby', async () => {
    await open(demo({ ...sample, docks: [] }));
    expect(await screen.findByText('Nobody nearby — try Home or wait')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
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
    const [first] = await findCards();
    const title = titleOf(first!);
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    expect(await screen.findByLabelText('You are here')).toHaveTextContent(title);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const j = (await backend.currentJourney(TZ))!;
    expect(j.hops).toHaveLength(2);
    expect(j.hops[0]!.songId).toBe(HOME.id);
    expect(songById.get(j.hops[1]!.songId)!.title).toBe(title);
    expect(nodeCount()).toBe(2);
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
    const [first] = await findCards();
    const title = titleOf(first!);
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
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
    const [first] = await findCards();
    const title = titleOf(first!);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    offline = true;
    fireEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(here()).toHaveTextContent(title);
    expect(nodeCount()).toBe(2);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(hopCalls).toBe(1); // retries look for the hop before sending it again
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    offline = false;
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(nodeCount()).toBe(2);
    expect(here()).toHaveTextContent(title);
    const j = (await backend.currentJourney(TZ))!;
    expect(j.hops).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    const [first] = await findCards();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hopCalls).toBe(1);
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
    expect(nodeCount()).toBe(2);
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('rolls a rejected hop back with a message', async () => {
    const base = demo();
    const backend: Backend = { ...base, hop: async () => { throw new BackendError('unknown_song'); } };
    await open(backend);
    const [first] = await findCards();
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't/i);
    expect(here()).toHaveTextContent(HOME.title);
    expect(nodeCount()).toBe(1);
  });

  it('streaming buttons link to the song in a new tab', async () => {
    await open(demo());
    const [first] = await findCards();
    const song = songOf(first!);
    const links = within(first!).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([song.spotifyUrl, song.appleUrl, song.youtubeUrl]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('cards show the Sample label, the ship colour and Like turns into Kept', async () => {
    const base = demo();
    const liked: string[] = [];
    const backend: Backend = { ...base, likeDock: async (id) => { liked.push(id); return null; } };
    await open(backend);
    const [first] = await findCards();
    expect(within(first!).getByText('Sample')).toBeInTheDocument();
    const dockId = first!.getAttribute('data-dock-id')!;
    const dock = sample.docks.find((d) => d.id === dockId)!;
    expect(first!.querySelector('[data-swatch]')).toHaveStyle({ backgroundColor: dock.shipColour });
    await userEvent.click(within(first!).getByRole('button', { name: 'Like' }));
    expect(within(first!).getByRole('button', { name: 'Kept' })).toBeDisabled();
    await vi.waitFor(() => expect(liked).toEqual([dockId]));
  });

  it('shows "+N others here" when more ships are docked at the song', async () => {
    const extra = sample.docks.flatMap((d, i) => [d, { ...d, id: `extra-${i}-a` }, { ...d, id: `extra-${i}-b` }]);
    await open(demo({ ...sample, docks: extra }));
    const [first] = await findCards();
    const songId = songOf(first!).id;
    const others = extra.filter((d) => d.songId === songId).length - 1;
    expect(others).toBeGreaterThanOrEqual(2);
    expect(within(first!).getByText(`+${others} others here`)).toBeInTheDocument();
  });

  it('tapping a ship on the map selects its card', async () => {
    await open(demo());
    await findCards();
    const second = cards()[1]!;
    const songId = songOf(second).id;
    await userEvent.click(screen.getByRole('button', { name: `ship ${songId}` }));
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(cards()[0]).not.toHaveAttribute('aria-current');
  });

  it('draws other ships docked at the current star (not your own); tapping one shows Like and links, no Hitchhike', async () => {
    const backend = demo();
    const at = sample.docks[0]!.songId;
    const theirs = sample.docks.filter((d) => d.songId === at).map((d) => d.id);
    const own = await backend.setDock(at);
    await backend.setHome(at);
    await backend.startJourney(TZ, at);
    render(<Explore backend={backend} tz={TZ} onNavigate={onNavigate} />);
    await findCards();
    expect(scene.props!.currentSongId).toBe(at);
    expect(scene.props!.hereDocks!.map((d) => d.id).sort()).toEqual([...theirs].sort());
    expect(screen.queryByRole('button', { name: `ship here ${own}` })).not.toBeInTheDocument();
    expect(dockIdsShown()).not.toContain(theirs[0]);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `ship here ${theirs[0]}` }));
    const region = screen.getByLabelText('Docked here');
    const card = within(region).getByRole('article');
    expect(card).toHaveAttribute('data-dock-id', theirs[0]);
    expect(within(card).getByRole('heading')).toHaveTextContent(songById.get(at)!.title);
    expect(within(card).getByText('Sample')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Spotify' })).toHaveAttribute('href', songById.get(at)!.spotifyUrl);
    expect(within(card).queryByRole('button', { name: 'Hitchhike' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Like' }));
    expect(within(card).getByRole('button', { name: 'Kept' })).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Docked here')).not.toBeInTheDocument();
    expect(await findCards()).toHaveLength(3);
  });

  it('after hitchhiking, the ship you flew alongside is drawn at the star you landed on', async () => {
    await open(demo());
    const [first] = await findCards();
    const dockId = first!.getAttribute('data-dock-id')!;
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await waitFor(() => expect(scene.props!.hereDocks!.map((d) => d.id)).toContain(dockId));
  });

  it('hides History and Inbox in demo mode; Ship and Dock navigate', async () => {
    await open(demo());
    await findCards();
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Inbox/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ship' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dock' }));
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
    await findCards();
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('button', { name: 'Inbox (new)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inbox (new)' }));
    expect(onNavigate.mock.calls).toEqual([['history'], ['inbox']]);
  });
});

describe('Explore path exclusion', () => {
  it('never shows a song already on today\'s path', async () => {
    const backend = demo();
    await open(backend);
    const user = userEvent.setup();
    const check = async () => {
      const j = (await backend.currentJourney(TZ))!;
      const path = new Set(j.hops.map((h) => h.songId));
      for (const c of cards()) expect(path.has(songOf(c).id)).toBe(false);
    };
    const [first] = await findCards();
    await user.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await check();
    await user.click(miniMap());
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: /^Go back to/ })[0]!);
    await check();
    await user.click(within(cards()[0]!).getByRole('button', { name: 'Hitchhike' }));
    await check();
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await check();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const becomeVisible = () => act(() => { document.dispatchEvent(new Event('visibilitychange')); });

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
    const [first] = await findCards();
    const title = titleOf(first!);
    const hopD = deferred();
    hopGate = hopD.promise;
    fireEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    const loadD = deferred();
    loadGate = loadD.promise;
    await becomeVisible(); // reload starts now: currentJourney answers without the new hop
    await act(async () => { hopD.resolve(); await hopD.promise; });
    expect(nodeCount()).toBe(2);
    await act(async () => { loadD.resolve(); await loadD.promise; await new Promise((r) => setTimeout(r, 0)); });
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
    const user = userEvent.setup();
    const [first] = await findCards();
    await user.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    const moveD = deferred();
    moveGate = moveD.promise;
    await user.click(miniMap());
    await user.click(screen.getByRole('button', { name: `Go back to ${HOME.title} by ${HOME.artist}` }));
    const loadD = deferred();
    loadGate = loadD.promise;
    await becomeVisible();
    await act(async () => { moveD.resolve(); await moveD.promise; await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { loadD.resolve(); await loadD.promise; await new Promise((r) => setTimeout(r, 0)); });
    expect(here()).toHaveTextContent(HOME.title);
  });

  it('after the day rolls over a reload keeps the map; the next hitchhike starts today\'s journey (Ruling 9)', async () => {
    const base = demo();
    let journeyReads = 0;
    const backend: Backend = { ...base, async currentJourney(tz) { journeyReads++; return base.currentJourney(tz); } };
    await open(backend);
    await findCards();
    const shown = dockIdsShown();
    storage.removeItem('mh.demo.journeys'); // 4am: today has no journey yet
    const reads = journeyReads;
    await becomeVisible();
    await waitFor(() => expect(journeyReads).toBeGreaterThan(reads));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText('Where do you want to start today?')).not.toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(dockIdsShown()).toEqual(shown);
    expect(here()).toHaveTextContent(HOME.title);

    const [first] = cards();
    const target = songOf(first!);
    await userEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    expect(here()).toHaveTextContent(target.title);
    await waitFor(async () => expect((await base.currentJourney(TZ))?.hops).toHaveLength(2));
    const j = (await base.currentJourney(TZ))!;
    expect(j.hops[0]!.songId).toBe(HOME.id);
    expect(j.hops[1]!.songId).toBe(target.id);
    expect(Object.keys(JSON.parse(storage.getItem('mh.demo.journeys')!))).toHaveLength(1); // one new journey
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(nodeCount()).toBe(2);
  });

  it('shows the start picker when no journey has been shown yet', async () => {
    await open(demo(), { start: false });
    expect(await screen.findByText('Where do you want to start today?')).toBeInTheDocument();
    await becomeVisible();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
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
    expect(await findCards()).toHaveLength(3);
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
    await open(backend);
    expect(await screen.findByRole('status')).toHaveTextContent(/offline/i);
    expect(await screen.findAllByRole('article', {}, { timeout: 3000 })).toHaveLength(3);
    expect(here()).toHaveTextContent(HOME.title);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    const [first] = await findCards();
    const title = titleOf(first!);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(1000));
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
    const [first] = await findCards();
    const title = titleOf(first!);
    startFails = 1;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(here()).toHaveTextContent(title);
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
  });

  it('a like the server rejects is no longer shown as Kept', async () => {
    const base = demo();
    const backend: Backend = { ...base, likeDock: async () => { throw new BackendError('unknown_dock'); } };
    await open(backend);
    const [first] = await findCards();
    await userEvent.click(within(first!).getByRole('button', { name: 'Like' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't keep/i);
    expect(within(first!).getByRole('button', { name: 'Like' })).toBeEnabled();
  });

  it('disposes its action queue on unmount', async () => {
    const backend = demo();
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    const { unmount } = render(<Explore backend={backend} tz={TZ} onNavigate={onNavigate} />);
    await findCards();
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
    const [first] = await findCards();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    offline = true;
    fireEvent.click(within(first!).getByRole('button', { name: 'Hitchhike' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Ship' }));
    const sheet = screen.getByRole('dialog', { name: 'Ship' });
    expect(screen.getByLabelText('You are here')).toBeInTheDocument(); // the map stays underneath
    await act(() => vi.advanceTimersByTimeAsync(1000));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(nodeCount()).toBe(2);
    offline = false;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect((await backend.currentJourney(TZ))!.hops).toHaveLength(2);
    expect(nodeCount()).toBe(2);
    expect(createActionQueue).toHaveBeenCalledTimes(1);
  });

  it('Dock saves over the map, closes the sheet and Explore reloads with the new dock', async () => {
    const user = userEvent.setup();
    const backend = demo();
    await backend.setHome(HOME.id);
    await backend.startJourney(TZ, HOME.id);
    render(<Shell backend={backend} tz={TZ} />);
    await findCards();
    const loads = vi.spyOn(backend, 'loadMap');
    await user.click(screen.getByRole('button', { name: 'Dock' }));
    const sheet = screen.getByRole('dialog', { name: 'Dock' });
    await user.type(within(sheet).getByRole('searchbox'), 'the');
    await vi.waitFor(() => expect(sheet.querySelector('.results button')).not.toBeNull(), { timeout: 2000 });
    const first = sheet.querySelector('.results button') as HTMLElement;
    const title = first.querySelector('.r-title')!.textContent!;
    const artist = first.querySelector('.r-artist')!.textContent!;
    const chosen = sample.songs.find((x) => x.title === title && x.artist === artist)!;
    await user.click(first);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await backend.getMyDock())!.songId).toBe(chosen.id);
    await vi.waitFor(() => expect(loads).toHaveBeenCalled());
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
    const inboxBtn = await screen.findByRole('button', { name: 'Inbox (new)' });
    await userEvent.click(inboxBtn);
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeInTheDocument();
    expect(await screen.findByText('Sugg')).toBeInTheDocument();
    expect(backend.markInboxSeen).toHaveBeenCalledTimes(1);
    (backend.getInbox as Mock).mockImplementation(async () => [{
      id: 'i1', kind: 'suggestion', songId: HOME.id, title: 'Sugg', artist: 'Band',
      shipColour: '#44aaff', replyTraceId: null, createdAt: '2026-11-03T10:00:00Z', seenAt: '2026-11-03T11:00:00Z',
    }]);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('button', { name: 'Inbox' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('Origin')).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Inbox (new)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Visit' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(scene.props?.currentSongId).toBe(other.id));
  });
});
