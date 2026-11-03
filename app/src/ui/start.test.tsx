import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackendError, type Backend, type Song } from '../backend/types.ts';
import { SHIP_COLOURS } from '@core/palette.ts';
import { StartFlow } from './StartFlow.tsx';
import { ShipPicker } from './ShipPicker.tsx';
import { DockSearch } from './DockSearch.tsx';

vi.mock('../map/ShipPreview.tsx', () => ({
  ShipPreview: ({ colour }: { colour: string }) => <div data-testid="preview" data-colour={colour} />,
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

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup(); vi.useRealTimers();
  if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  else delete (navigator as unknown as Record<string, unknown>).clipboard;
});

const song = (n: number): Song => ({
  id: `s${n}`, title: `Title ${n}`, artist: `Artist ${n}`, x: 0, y: 0, z: 0, regionId: 0,
  spotifyUrl: '', appleUrl: '', youtubeUrl: '',
} as unknown as Song);

function fake(over: Partial<Backend> = {}): Backend {
  const fail = () => { throw new Error('not stubbed'); };
  return {
    mode: 'live',
    getSession: vi.fn(async () => ({ isMember: false })),
    redeemInvite: vi.fn(async () => ({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS' })),
    recover: vi.fn(async () => {}),
    searchSongs: vi.fn(async (q: string) => (q.length < 2 ? [] : [song(1), song(2)])),
    getProfile: vi.fn(async () => ({ homeSongId: null, colourSeed: 'x', shipColour: SHIP_COLOURS[3]! })),
    setDock: vi.fn(async () => 'dock'),
    setHome: vi.fn(async () => {}),
    setShipColour: vi.fn(async () => {}),
    loadMap: fail, getSongs: fail, getMyDock: fail, currentJourney: fail, startJourney: fail, hop: fail,
    moveTo: fail, likeDock: fail, getTraces: fail, findTrace: fail, sendSuggestion: fail, getInbox: fail,
    markInboxSeen: fail,
    ...over,
  } as unknown as Backend;
}

describe('StartFlow', () => {
  it('invite path shows the recovery code and needs "I\'ve saved it"', async () => {
    const user = userEvent.setup();
    const backend = fake();
    const onDone = vi.fn();
    render(<StartFlow backend={backend} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'I have an invite' }));
    await user.type(screen.getByLabelText('Invite code'), 'INVITE1');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(backend.redeemInvite).toHaveBeenCalledWith('INVITE1');
    expect(await screen.findByText('ABCD EFGH JKMN PQRS')).toBeInTheDocument();
    expect(screen.getByText("Save this code. Without it your account can't be recovered.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(onDone).toHaveBeenCalledWith('new');
  });

  it('copy falls back to a message when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    render(<StartFlow backend={fake()} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'I have an invite' }));
    await user.type(screen.getByLabelText('Invite code'), 'X');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('ABCD EFGH JKMN PQRS');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByText(/Select the code and copy it by hand/)).toBeInTheDocument();
  });

  it('an invite that signs into an existing account says welcome back and skips the code', async () => {
    const user = userEvent.setup();
    const backend = fake({ getProfile: vi.fn(async () => ({ homeSongId: 'h', colourSeed: 'x', shipColour: '#fff' })) });
    const onDone = vi.fn();
    render(<StartFlow backend={backend} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'I have an invite' }));
    await user.type(screen.getByLabelText('Invite code'), 'X');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.queryByText(/Save this code/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onDone).toHaveBeenCalledWith('returning');
  });

  it('"I\'ve saved it" records that the code was saved; resuming shows the unsaved code first', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const onDone = vi.fn();
    render(<StartFlow backend={fake()} storage={storage} resumeCode="ABCDEFGHJKMNPQRS" onDone={onDone} />);
    expect(screen.getByText('ABCD EFGH JKMN PQRS')).toBeInTheDocument();
    expect(storage.getItem('mh.recoveryCodeSaved')).toBeNull();
    await user.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(storage.getItem('mh.recoveryCodeSaved')).toBe('1');
    expect(onDone).toHaveBeenCalledWith('new');
  });

  it('shows invite errors and stays on the form', async () => {
    const user = userEvent.setup();
    const backend = fake({ redeemInvite: vi.fn(async () => { throw new BackendError('invalid_invite'); }) });
    render(<StartFlow backend={backend} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'I have an invite' }));
    await user.type(screen.getByLabelText('Invite code'), 'NOPE');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That invite didn't work");
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
  });

  it.each([
    ['rate_limited', 'Too many tries — wait a minute and try again'],
    ['network', "You're offline — try again when you're connected"],
    ['weird', 'Something went wrong — try again'],
  ])('maps %s', async (code, text) => {
    const user = userEvent.setup();
    const backend = fake({ redeemInvite: vi.fn(async () => { throw new BackendError(code); }) });
    render(<StartFlow backend={backend} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'I have an invite' }));
    await user.type(screen.getByLabelText('Invite code'), 'NOPE');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('recovery accepts lowercase spaced input and calls recover', async () => {
    const user = userEvent.setup();
    const backend = fake();
    const onDone = vi.fn();
    render(<StartFlow backend={backend} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'I have a recovery code' }));
    // a real code, lowercased and spaced
    const { encodeRecoveryCode } = await import('@core/recovery.ts');
    const real = encodeRecoveryCode('11111111-2222-4333-8444-555555555555', new Uint8Array(10).fill(7));
    const typed = real.replace(/-/g, ' ').toLowerCase();
    await user.type(screen.getByLabelText('Recovery code'), typed);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(backend.recover).toHaveBeenCalledTimes(1);
    expect(backend.recover).toHaveBeenCalledWith(typed);
    expect(onDone).toHaveBeenCalledWith('returning');
  });

  it('a wrong recovery code is rejected locally without a network call', async () => {
    const user = userEvent.setup();
    const backend = fake();
    const onDone = vi.fn();
    render(<StartFlow backend={backend} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'I have a recovery code' }));
    await user.type(screen.getByLabelText('Recovery code'), 'not a code');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
    expect(backend.recover).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a bad_code from the server keeps the user on Start', async () => {
    const user = userEvent.setup();
    const backend = fake({ recover: vi.fn(async () => { throw new BackendError('bad_code'); }) });
    const onDone = vi.fn();
    render(<StartFlow backend={backend} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'I have a recovery code' }));
    const { encodeRecoveryCode } = await import('@core/recovery.ts');
    await user.type(screen.getByLabelText('Recovery code'), encodeRecoveryCode('11111111-2222-4333-8444-555555555555', new Uint8Array(10).fill(7)));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('ShipPicker', () => {
  it('offers 12 swatches, starts on the current colour and saves the chosen one', async () => {
    const user = userEvent.setup();
    const backend = fake();
    const onDone = vi.fn();
    render(<ShipPicker backend={backend} onDone={onDone} />);
    const swatches = await screen.findAllByRole('button', { name: /^Colour \d+ of 12$/ });
    expect(swatches).toHaveLength(12);
    expect(swatches[3]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('preview')).toHaveAttribute('data-colour', SHIP_COLOURS[3]);
    await user.click(swatches[7]!);
    expect(screen.getByTestId('preview')).toHaveAttribute('data-colour', SHIP_COLOURS[7]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(backend.setShipColour).toHaveBeenCalledWith(SHIP_COLOURS[7]);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('DockSearch', () => {
  async function setup(backend: Backend) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onDone = vi.fn();
    render(<DockSearch backend={backend} onDone={onDone} />);
    await screen.findByRole('checkbox', { name: 'Also make this home' });
    return { user, onDone };
  }

  it('debounces, ignores 1 char, then docks and sets home when checked', async () => {
    const backend = fake();
    const { user, onDone } = await setup(backend);
    const box = screen.getByRole('searchbox');
    expect(screen.getByRole('checkbox', { name: 'Also make this home' })).toBeChecked();
    await user.type(box, 'a');
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(backend.searchSongs).not.toHaveBeenCalled();
    await user.type(box, 'b');
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(backend.searchSongs).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(backend.searchSongs).toHaveBeenCalledWith('ab');
    await user.click(await screen.findByRole('button', { name: /Title 2/ }));
    expect(backend.setDock).toHaveBeenCalledWith('s2');
    expect(backend.setHome).toHaveBeenCalledWith('s2');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('result buttons wait for the profile so home is never skipped by an early tap', async () => {
    let release!: (p: { homeSongId: null; colourSeed: string; shipColour: string }) => void;
    const backend = fake({ getProfile: vi.fn(() => new Promise<never>((r) => { release = r as unknown as typeof release; })) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DockSearch backend={backend} onDone={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'ab');
    await act(() => vi.advanceTimersByTimeAsync(300));
    const btn = await screen.findByRole('button', { name: /Title 1/ });
    expect(btn).toBeDisabled();
    await act(async () => release({ homeSongId: null, colourSeed: 'x', shipColour: '#fff' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Title 1/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Title 1/ }));
    expect(backend.setHome).toHaveBeenCalledWith('s1');
  });

  it('does not set home when unchecked, and defaults unchecked when a home exists', async () => {
    const backend = fake({
      getProfile: vi.fn(async () => ({ homeSongId: 'h', colourSeed: 'x', shipColour: '#fff' })),
    });
    const { user } = await setup(backend);
    expect(screen.getByRole('checkbox', { name: 'Also make this home' })).not.toBeChecked();
    await user.type(screen.getByRole('searchbox'), 'ab');
    await act(() => vi.advanceTimersByTimeAsync(300));
    await user.click(await screen.findByRole('button', { name: /Title 1/ }));
    expect(backend.setDock).toHaveBeenCalledWith('s1');
    expect(backend.setHome).not.toHaveBeenCalled();
  });
});
