import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseBackend } from './supabase.ts';

function memoryStorage(opts: { throwOnSet?: boolean } = {}): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { if (opts.throwOnSet) throw new Error('quota'); m.set(k, String(v)); },
  };
}

/** A chainable stand-in for a postgrest query that resolves to `result`. */
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'range', 'eq']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
  return q;
}

describe('SupabaseBackend (unit)', () => {
  it('maps a postgrest fetch failure (status 0, TypeError message) to network', async () => {
    for (const message of ['TypeError: Load failed', 'TypeError: fetch failed']) {
      const client = {
        from: () => query({ data: null, status: 0, error: { message, code: '', details: '', hint: '' } }),
      } as unknown as SupabaseClient;
      const err = await createSupabaseBackend(client, memoryStorage()).loadMap().catch((e) => e);
      expect(err.code).toBe('network');
    }
  });

  it('pages loadMap in 1000-row pages until a short page', async () => {
    const ranges: [number, number][] = [];
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, x: 0, y: 0, z: 0, adjacent: [] }));
    const client = {
      from: () => {
        const q = query({ data: [], error: null });
        let range: [number, number] = [0, 0];
        q.range = (a: number, b: number) => { range = [a, b]; ranges.push(range); return q; };
        q.then = (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: range[0] === 0 ? rows(1000) : rows(5), error: null }).then(ok);
        return q;
      },
    } as unknown as SupabaseClient;
    const map = await createSupabaseBackend(client, memoryStorage()).loadMap();
    expect(map.regions).toHaveLength(1005);
    expect(ranges.filter((r) => r[0] === 1000)).toHaveLength(3);
  });

  it('fails with storage before any network call when the recovery code cannot be stored', async () => {
    let calls = 0;
    const client = {
      auth: { getSession: async () => { calls++; return { data: { session: null } }; } },
    } as unknown as SupabaseClient;
    const err = await createSupabaseBackend(client, memoryStorage({ throwOnSet: true }))
      .redeemInvite('ABC').catch((e) => e);
    expect(err.code).toBe('storage');
    expect(calls).toBe(0);
  });
});
