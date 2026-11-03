import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionQueue, type QueuedAction } from './retry.ts';
import { BackendError } from './types.ts';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const like: QueuedAction = { id: 'a1', kind: 'like', dockId: 'd1' };

describe('action queue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('retries a failing send with the given delays; offline until a send succeeds', async () => {
    const send = vi.fn<(a: QueuedAction) => Promise<void>>()
      .mockRejectedValueOnce(new BackendError('network'))
      .mockRejectedValueOnce(new BackendError('network'))
      .mockResolvedValue(undefined);
    const q = createActionQueue({ send, storage: memoryStorage(), delays: [100, 200, 400] });
    const seen: boolean[] = [];
    q.subscribe((o) => seen.push(o));
    expect(q.online()).toBe(true);

    q.enqueue(like);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.online()).toBe(false);

    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.online()).toBe(false);

    await vi.advanceTimersByTimeAsync(199);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(q.online()).toBe(true);
    expect(seen).toEqual([false, true]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('keeps using the last delay once the list runs out', async () => {
    const send = vi.fn<(a: QueuedAction) => Promise<void>>().mockRejectedValue(new BackendError('network'));
    const q = createActionQueue({ send, storage: memoryStorage(), delays: [10, 20] });
    q.enqueue(like);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(20);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('queued actions survive a reload via storage', async () => {
    const storage = memoryStorage();
    const failing = vi.fn<(a: QueuedAction) => Promise<void>>().mockRejectedValue(new BackendError('network'));
    const q1 = createActionQueue({ send: failing, storage, delays: [1000] });
    q1.enqueue(like);
    q1.enqueue({ id: 'a2', kind: 'markInboxSeen' });
    await vi.advanceTimersByTimeAsync(0);

    const sent: QueuedAction[] = [];
    const q2 = createActionQueue({ send: async (a) => { sent.push(a); }, storage, delays: [1000] });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(q2.online()).toBe(true);

    const q3 = createActionQueue({ send: async (a) => { sent.push(a); }, storage });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(2);
    q3.enqueue({ id: 'a3', kind: 'markInboxSeen' });
    await q3.flush();
    expect(sent).toHaveLength(3);
  });

  it('drops a non-network BackendError and reports it once', async () => {
    const send = vi.fn<(a: QueuedAction) => Promise<void>>()
      .mockRejectedValueOnce(new BackendError('own_dock'))
      .mockResolvedValue(undefined);
    const q = createActionQueue({ send, storage: memoryStorage(), delays: [10] });
    const errors: BackendError[] = [];
    q.subscribe((_o, e) => { if (e) errors.push(e); });
    q.enqueue(like);
    q.enqueue({ id: 'a2', kind: 'markInboxSeen' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors.map((e) => e.code)).toEqual(['own_dock']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.online()).toBe(true);
  });

  it('unsubscribe stops notifications', async () => {
    const send = vi.fn<(a: QueuedAction) => Promise<void>>().mockRejectedValueOnce(new BackendError('network')).mockResolvedValue(undefined);
    const q = createActionQueue({ send, storage: memoryStorage(), delays: [10] });
    const fn = vi.fn();
    q.subscribe(fn)();
    q.enqueue(like);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it('retries unknown and rate_limited errors and non-BackendError throws', async () => {
    const send = vi.fn<(a: QueuedAction) => Promise<void>>()
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockRejectedValueOnce(new BackendError('rate_limited'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const q = createActionQueue({ send, storage: memoryStorage(), delays: [10] });
    const errors: unknown[] = [];
    q.subscribe((_o, e) => { if (e) errors.push(e); });
    q.enqueue(like);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(4);
    expect(errors).toEqual([]);
    expect(q.online()).toBe(true);
  });

  it('discards corrupt persisted entries on load but keeps valid ones', async () => {
    const storage = memoryStorage();
    storage.setItem('mh.queue', JSON.stringify([
      { id: 'x', kind: 'like' }, null, 5, { id: 'y', kind: 'nope' }, like, { id: 'z', kind: 'markInboxSeen' },
    ]));
    const sent: string[] = [];
    createActionQueue({ send: async (a) => { sent.push(a.id); }, storage });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['a1', 'z']);
  });
});
