import { BackendError } from './types.ts';

/** Only idempotent actions are queued; hops are retried in place because they return ids the tree needs. */
export type QueuedAction =
  | { id: string; kind: 'like'; dockId: string }
  | { id: string; kind: 'markInboxSeen' };

/** `action` is the dropped action when `error` is set. */
export type QueueListener = (online: boolean, error?: BackendError, action?: QueuedAction) => void;

export interface ActionQueue {
  enqueue(a: QueuedAction): void;
  online: () => boolean;
  /** Called when `online` changes, and with `(online, error)` when an action is dropped for a non-network error. */
  subscribe(fn: QueueListener): () => void;
  flush(): Promise<void>;
  /** Stops timers and notifications; unsent actions stay in storage for the next queue. */
  dispose(): void;
}

const KEY = 'mh.queue';
const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function isAction(v: unknown): v is QueuedAction {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string') return false;
  return a.kind === 'markInboxSeen' || (a.kind === 'like' && typeof a.dockId === 'string');
}

/** Transient failures are retried; only known server rejections drop the action. */
const RETRYABLE_CODES = new Set(['network', 'unknown', 'rate_limited']);

export function createActionQueue(opts: {
  send: (a: QueuedAction) => Promise<void>;
  storage: Storage;
  delays?: number[];
}): ActionQueue {
  const { send, storage } = opts;
  const delays = opts.delays && opts.delays.length > 0 ? opts.delays : DEFAULT_DELAYS;

  const load = (): QueuedAction[] => {
    try {
      const v: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
      return Array.isArray(v) ? v.filter(isAction) : [];
    } catch {
      return [];
    }
  };
  let pending = load();
  const save = (): void => {
    try { storage.setItem(KEY, JSON.stringify(pending)); } catch { /* storage unavailable */ }
  };

  let isOnline = true;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let disposed = false;
  const listeners = new Set<QueueListener>();
  const emit = (online: boolean, error?: BackendError, action?: QueuedAction): void => {
    if (disposed) return;
    for (const fn of [...listeners]) fn(online, error, action);
  };
  const setOnline = (v: boolean): void => {
    if (v === isOnline) return;
    isOnline = v;
    emit(v);
  };

  async function drain(): Promise<void> {
    while (pending.length > 0 && !disposed) {
      const head = pending[0];
      try {
        await send(head);
      } catch (e) {
        if (e instanceof BackendError && !RETRYABLE_CODES.has(e.code)) {
          pending = pending.filter((a) => a.id !== head.id);
          save();
          emit(isOnline, e, head);
          continue;
        }
        if (disposed) return;
        setOnline(false);
        const delay = delays[Math.min(attempt, delays.length - 1)];
        attempt += 1;
        timer = setTimeout(() => { timer = null; void flush(); }, delay);
        return;
      }
      pending = pending.filter((a) => a.id !== head.id);
      save();
      attempt = 0;
      setOnline(true);
    }
    setOnline(true);
  }

  function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (disposed) return Promise.resolve();
    if (!running) {
      running = drain().finally(() => { running = null; });
    }
    return running;
  }

  if (pending.length > 0) void flush();

  return {
    enqueue(a) {
      if (disposed) return;
      pending = [...pending, a];
      save();
      if (!timer) void flush();
    },
    online: () => isOnline,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    flush,
    dispose() {
      disposed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      listeners.clear();
    },
  };
}
