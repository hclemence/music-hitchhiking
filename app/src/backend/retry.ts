import { BackendError } from './types.ts';

/** Only idempotent actions are queued; hops are retried in place because they return ids the tree needs. */
export type QueuedAction =
  | { id: string; kind: 'like'; dockId: string }
  | { id: string; kind: 'markInboxSeen' };

export type QueueListener = (online: boolean, error?: BackendError) => void;

export interface ActionQueue {
  enqueue(a: QueuedAction): void;
  online: () => boolean;
  /** Called when `online` changes, and with `(online, error)` when an action is dropped for a non-network error. */
  subscribe(fn: QueueListener): () => void;
  flush(): Promise<void>;
}

const KEY = 'mh.queue';
const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

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
      return Array.isArray(v) ? (v as QueuedAction[]) : [];
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
  const listeners = new Set<QueueListener>();
  const emit = (online: boolean, error?: BackendError): void => {
    for (const fn of [...listeners]) fn(online, error);
  };
  const setOnline = (v: boolean): void => {
    if (v === isOnline) return;
    isOnline = v;
    emit(v);
  };

  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const head = pending[0];
      try {
        await send(head);
      } catch (e) {
        if (e instanceof BackendError && e.code !== 'network') {
          pending = pending.filter((a) => a.id !== head.id);
          save();
          emit(isOnline, e);
          continue;
        }
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
    if (!running) {
      running = drain().finally(() => { running = null; });
    }
    return running;
  }

  if (pending.length > 0) void flush();

  return {
    enqueue(a) {
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
  };
}
