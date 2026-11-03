import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_RADIUS } from '@core/placement.ts';
import { encodeRecoveryCode } from '@core/recovery.ts';
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

  it('maps a null region_id to NaN (neutral colour) and a null local_radius to the core default', async () => {
    const star = {
      id: 's', title: 't', artist: 'a', x: 1, y: 2, z: 3, region_id: null, local_radius: null, brightness: 0.5,
      spotify_url: '', apple_url: '', youtube_url: '',
    };
    const client = {
      from: (table: string) => query({ data: table === 'active_stars' ? [star] : [], error: null }),
    } as unknown as SupabaseClient;
    const map = await createSupabaseBackend(client, memoryStorage()).loadMap();
    expect(map.stars[0]!.regionId).toBeNaN();
    expect(map.stars[0]!.localRadius).toBe(DEFAULT_LOCAL_RADIUS);
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

const USER = '11111111-2222-4333-8444-555555555555';
const BAD_LOGIN = { error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } };
const NETWORK_LOGIN = { error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } };
const RATE_LIMITED_LOGIN = { error: { status: 429, code: 'over_request_rate_limit', message: 'Too many requests' } };
const httpError = (status: number, error: string) => ({
  data: null,
  error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError', context: new Response(JSON.stringify({ error }), { status }),
  }),
});

/** Auth + functions stand-in: anonymous sign-in makes USER; password sign-in answers with `signIn`. */
function authClient(opts: {
  session?: boolean;
  signIn: () => { error: unknown };
  invoke: () => unknown;
}) {
  let session = opts.session ? { user: { id: USER } } : null;
  const calls = { signIn: 0, invoke: 0 };
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async () => { session = { user: { id: USER } }; return { error: null }; },
      signInWithPassword: async () => { calls.signIn++; return opts.signIn(); },
    },
    functions: { invoke: async () => { calls.invoke++; return opts.invoke(); } },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('SupabaseBackend recovery code hygiene (Ruling 10)', () => {
  it('writing a fresh code clears a saved flag left by an earlier account', async () => {
    const storage = memoryStorage();
    storage.setItem('mh.recoveryCodeSaved', '1');
    const { client } = authClient({ signIn: () => ({ error: null }), invoke: () => ({ data: { ok: true }, error: null }) });
    const { recoveryCode } = await createSupabaseBackend(client, storage).redeemInvite('INVITE');
    expect(storage.getItem('mh.recoveryCode')).toBe(recoveryCode);
    expect(storage.getItem('mh.recoveryCodeSaved')).toBeNull();
  });

  it('clears the saved flag before calling the function (a lost response still resumes the code)', async () => {
    const storage = memoryStorage();
    storage.setItem('mh.recoveryCodeSaved', '1');
    let flagAtInvoke: string | null = 'unset';
    const { client } = authClient({
      signIn: () => NETWORK_LOGIN,
      invoke: () => { flagAtInvoke = storage.getItem('mh.recoveryCodeSaved'); throw new TypeError('Failed to fetch'); },
    });
    const err = await createSupabaseBackend(client, storage).redeemInvite('INVITE').catch((e) => e);
    expect(err.code).toBe('network');
    expect(flagAtInvoke).toBeNull();
    expect(storage.getItem('mh.recoveryCode')).not.toBeNull();
  });

  it('removes the stored code after a definitive rejection when the code does not sign in (bad_code)', async () => {
    const storage = memoryStorage();
    const { client } = authClient({ signIn: () => BAD_LOGIN, invoke: () => httpError(400, 'invalid_invite') });
    const err = await createSupabaseBackend(client, storage).redeemInvite('NOPE').catch((e) => e);
    expect(err.code).toBe('invalid_invite');
    expect(storage.getItem('mh.recoveryCode')).toBeNull();
  });

  it.each([
    ['network', NETWORK_LOGIN],
    ['rate_limited', RATE_LIMITED_LOGIN],
  ])('keeps the stored code after a definitive rejection when the sign-in check failed with %s', async (_, login) => {
    const storage = memoryStorage();
    const { client } = authClient({ signIn: () => login, invoke: () => httpError(400, 'invalid_invite') });
    const err = await createSupabaseBackend(client, storage).redeemInvite('NOPE').catch((e) => e);
    expect(err.code).toBe('invalid_invite');
    const kept = storage.getItem('mh.recoveryCode');
    expect(kept).not.toBeNull();
    expect(kept!.length).toBeGreaterThan(20);
  });

  it('keeps the stored code after a non-definitive failure even when sign-in says bad_code', async () => {
    const storage = memoryStorage();
    const { client } = authClient({ signIn: () => BAD_LOGIN, invoke: () => httpError(500, 'internal') });
    const err = await createSupabaseBackend(client, storage).redeemInvite('X').catch((e) => e);
    expect(err.code).toBe('internal');
    expect(storage.getItem('mh.recoveryCode')).not.toBeNull();
  });

  it('a successful recover() removes the stored code; a failed one keeps it', async () => {
    const code = encodeRecoveryCode(USER, new Uint8Array(10).fill(7));
    const storage = memoryStorage();
    storage.setItem('mh.recoveryCode', 'UNSAVED');
    const bad = authClient({ signIn: () => BAD_LOGIN, invoke: () => null });
    expect((await createSupabaseBackend(bad.client, storage).recover(code).catch((e) => e)).code).toBe('bad_code');
    expect(storage.getItem('mh.recoveryCode')).toBe('UNSAVED');
    const good = authClient({ signIn: () => ({ error: null }), invoke: () => null });
    await createSupabaseBackend(good.client, storage).recover(code);
    expect(storage.getItem('mh.recoveryCode')).toBeNull();
  });
});
