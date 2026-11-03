import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackendError, type Backend, type InboxItem, type Song, type Trace } from '../backend/types.ts';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { Inbox } from './Inbox.tsx';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const song = (n: number): Song => ({
  id: `s${n}`, title: `Title ${n}`, artist: `Artist ${n}`, x: 0, y: 0, z: 0, regionId: 0,
  spotifyUrl: '', appleUrl: '', youtubeUrl: '',
} as unknown as Song);

const trace = (n: number, over: Partial<Trace> = {}): Trace => ({
  id: `t${n}`, originSongId: `o${n}`, originTitle: `Origin ${n}`, originArtist: `Maker ${n}`,
  shipColour: '#ff8844', brightness: 0.6, ...over,
});

const item = (n: number, over: Partial<InboxItem> = {}): InboxItem => ({
  id: `i${n}`, kind: 'suggestion', songId: `x${n}`, title: `Sent ${n}`, artist: `Band ${n}`,
  shipColour: '#44aaff', replyTraceId: `r${n}`, createdAt: '2026-11-03T10:00:00Z', seenAt: null, ...over,
});

function fake(over: Partial<Backend> = {}): Backend {
  const fail = () => { throw new Error('not stubbed'); };
  return {
    mode: 'live',
    getTraces: vi.fn(async () => [trace(1), trace(2)]),
    findTrace: vi.fn(async () => 'found-song'),
    sendSuggestion: vi.fn(async () => {}),
    getInbox: vi.fn(async () => [item(1)]),
    markInboxSeen: vi.fn(async () => {}),
    searchSongs: vi.fn(async (q: string) => (q.length < 2 ? [] : [song(1), song(2)])),
    loadMap: fail, getSongs: fail, getProfile: fail, getMyDock: fail,
    ...over,
  } as unknown as Backend;
}

async function chooseSong(user: ReturnType<typeof userEvent.setup>, title = 'Title 1') {
  await user.type(screen.getByLabelText('Search songs or artists'), 'ti');
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }));
}

describe('HistoryDrawer', () => {
  it('lists traces with origin song and a strength bar, never a name', async () => {
    render(<HistoryDrawer backend={fake()} onJump={vi.fn()} />);
    expect(await screen.findByText('Origin 1')).toBeInTheDocument();
    expect(screen.getByText('Maker 2')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Trace strength 60%' })).toHaveLength(2);
  });

  it('shows the empty state', async () => {
    render(<HistoryDrawer backend={fake({ getTraces: vi.fn(async () => []) })} onJump={vi.fn()} />);
    expect(await screen.findByText('No traces yet — like a song someone\'s docked at to leave one')).toBeInTheDocument();
  });

  it('Find with a null result says they are not docked and does not jump', async () => {
    const onJump = vi.fn();
    render(<HistoryDrawer backend={fake({ findTrace: vi.fn(async () => null) })} onJump={onJump} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Find' }))[0]!);
    expect(await screen.findByText("They're not docked right now")).toBeInTheDocument();
    expect(onJump).not.toHaveBeenCalled();
  });

  it('Find with a song calls onJump', async () => {
    const onJump = vi.fn();
    const backend = fake();
    render(<HistoryDrawer backend={backend} onJump={onJump} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Find' }))[1]!);
    expect(backend.findTrace).toHaveBeenCalledWith('t2');
    expect(onJump).toHaveBeenCalledWith('found-song');
  });

  it('Find: trace_faded shows the message and removes the row', async () => {
    const backend = fake({ findTrace: vi.fn(async () => { throw new BackendError('trace_faded'); }) });
    render(<HistoryDrawer backend={backend} onJump={vi.fn()} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Find' }))[0]!);
    expect(await screen.findByText('This trace has faded')).toBeInTheDocument();
    expect(screen.queryByText('Origin 1')).not.toBeInTheDocument();
    expect(screen.getByText('Origin 2')).toBeInTheDocument();
  });

  it('Find: network error shows the offline copy', async () => {
    const backend = fake({ findTrace: vi.fn(async () => { throw new BackendError('network'); }) });
    render(<HistoryDrawer backend={backend} onJump={vi.fn()} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Find' }))[0]!);
    expect(await screen.findByText("You're offline — try again when you're connected")).toBeInTheDocument();
  });

  it('Send a song searches, sends, confirms, and refreshes the traces', async () => {
    const user = userEvent.setup();
    const backend = fake();
    render(<HistoryDrawer backend={backend} onJump={vi.fn()} />);
    await user.click((await screen.findAllByRole('button', { name: 'Send a song' }))[0]!);
    await chooseSong(user);
    expect(backend.sendSuggestion).toHaveBeenCalledWith('t1', 's1');
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search songs or artists')).not.toBeInTheDocument();
    expect(backend.getTraces).toHaveBeenCalledTimes(2);
  });

  it('suggestion_limit shows its message and keeps the search open', async () => {
    const user = userEvent.setup();
    const backend = fake({ sendSuggestion: vi.fn(async () => { throw new BackendError('suggestion_limit'); }) });
    render(<HistoryDrawer backend={backend} onJump={vi.fn()} />);
    await user.click((await screen.findAllByRole('button', { name: 'Send a song' }))[0]!);
    await chooseSong(user);
    expect(await screen.findByText('Wait for them to see your last songs')).toBeInTheDocument();
  });

  it('send: trace_faded shows its message and drops the row', async () => {
    const user = userEvent.setup();
    const backend = fake({ sendSuggestion: vi.fn(async () => { throw new BackendError('trace_faded'); }) });
    render(<HistoryDrawer backend={backend} onJump={vi.fn()} />);
    await user.click((await screen.findAllByRole('button', { name: 'Send a song' }))[0]!);
    await chooseSong(user);
    expect(await screen.findByText('This trace has faded')).toBeInTheDocument();
    expect(screen.queryByText('Origin 1')).not.toBeInTheDocument();
    expect(screen.getByText('Origin 2')).toBeInTheDocument();
  });

  it('send: an unknown error shows the generic copy', async () => {
    const user = userEvent.setup();
    const backend = fake({ sendSuggestion: vi.fn(async () => { throw new BackendError('bad_trace'); }) });
    render(<HistoryDrawer backend={backend} onJump={vi.fn()} />);
    await user.click((await screen.findAllByRole('button', { name: 'Send a song' }))[0]!);
    await chooseSong(user);
    expect(await screen.findByText('Something went wrong — try again')).toBeInTheDocument();
  });
});

describe('Inbox', () => {
  it('shows an empty state', async () => {
    render(<Inbox backend={fake({ getInbox: vi.fn(async () => []) })} onJump={vi.fn()} />);
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  });

  it('marks the inbox seen once on opening', async () => {
    const backend = fake();
    const { rerender } = render(<Inbox backend={backend} onJump={vi.fn()} />);
    await screen.findByText('Sent 1');
    rerender(<Inbox backend={backend} onJump={vi.fn()} />);
    expect(backend.markInboxSeen).toHaveBeenCalledTimes(1);
  });

  it('suggestion rows show Visit and Reply; Visit jumps', async () => {
    const onJump = vi.fn();
    render(<Inbox backend={fake()} onJump={onJump} />);
    await screen.findByText('Sent 1');
    await userEvent.click(screen.getByRole('button', { name: 'Visit' }));
    expect(onJump).toHaveBeenCalledWith('x1');
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });

  it('hides Reply when replyTraceId is null', async () => {
    render(<Inbox backend={fake({ getInbox: vi.fn(async () => [item(1, { replyTraceId: null })]) })} onJump={vi.fn()} />);
    await screen.findByText('Sent 1');
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visit' })).toBeInTheDocument();
  });

  it('Reply sends via the reply trace and confirms', async () => {
    const user = userEvent.setup();
    const backend = fake();
    render(<Inbox backend={backend} onJump={vi.fn()} />);
    await screen.findByText('Sent 1');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await chooseSong(user, 'Title 2');
    expect(backend.sendSuggestion).toHaveBeenCalledWith('r1', 's2');
    expect(await screen.findByText('Sent')).toBeInTheDocument();
  });

  it('Reply: suggestion_limit shows its message', async () => {
    const user = userEvent.setup();
    const backend = fake({ sendSuggestion: vi.fn(async () => { throw new BackendError('suggestion_limit'); }) });
    render(<Inbox backend={backend} onJump={vi.fn()} />);
    await screen.findByText('Sent 1');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await chooseSong(user);
    expect(await screen.findByText('Wait for them to see your last songs')).toBeInTheDocument();
  });

  it('kept rows read "Someone kept your song" with no swatch or actions', async () => {
    const kept = item(2, { kind: 'kept', shipColour: null, replyTraceId: null, title: 'Mine' });
    render(<Inbox backend={fake({ getInbox: vi.fn(async () => [kept]) })} onJump={vi.fn()} />);
    const row = (await screen.findByText('Someone kept your song: Mine')).closest('li')!;
    expect(row.querySelector('.ship-dot')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
  });
});
