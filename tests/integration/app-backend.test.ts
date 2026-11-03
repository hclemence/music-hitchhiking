import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { createSupabaseBackend, RECOVERY_CODE_KEY } from '../../app/src/backend/supabase.ts';
import { BackendError, type Backend } from '../../app/src/backend/types.ts';
import { decodeRecoveryCode, generateInviteCode, hashInviteCode } from '../../supabase/functions/_shared/core/recovery.ts';
import { adminClient, anonClient, stack } from './stack.ts';

const admin = adminClient();
const hashes: string[] = [];

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

async function newInvite(): Promise<string> {
  const code = generateInviteCode();
  const code_hash = await hashInviteCode(code);
  const { error } = await admin.from('invites').insert({
    code_hash, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (error) throw error;
  hashes.push(code_hash);
  return code;
}

interface Person { backend: Backend; client: SupabaseClient; storage: Storage; recoveryCode: string; id: string }

async function newMember(): Promise<Person> {
  const client = anonClient();
  const storage = memoryStorage();
  const backend = createSupabaseBackend(client, storage);
  const { recoveryCode } = await backend.redeemInvite(await newInvite());
  return { backend, client, storage, recoveryCode, id: decodeRecoveryCode(recoveryCode)!.userId };
}

const people: Person[] = [];
afterAll(async () => {
  if (hashes.length) await admin.from('invites').delete().in('code_hash', hashes);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

describe('SupabaseBackend', () => {
  let a: Person;
  let b: Person;
  let songs: { id: string }[];
  let aDock: string;

  it('has no session before redeeming', async () => {
    const backend = createSupabaseBackend(anonClient(), memoryStorage());
    expect(await backend.getSession()).toBeNull();
  });

  it('redeems an invite, storing the recovery code before the call', async () => {
    const storage = memoryStorage();
    const seenBeforeCall: (string | null)[] = [];
    // Spy on the wire: the code must already be in storage when the function request goes out.
    const client = createClient(stack().url, stack().anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          if (String(input instanceof Request ? input.url : input).includes('/functions/v1/redeem-invite')) {
            seenBeforeCall.push(storage.getItem(RECOVERY_CODE_KEY));
          }
          return fetch(input, init);
        },
      },
    });
    const wrapped = createSupabaseBackend(client, storage);
    const { recoveryCode } = await wrapped.redeemInvite(await newInvite());
    expect(seenBeforeCall).toEqual([recoveryCode]);
    expect(storage.getItem(RECOVERY_CODE_KEY)).toBe(recoveryCode);
    a = { backend: wrapped, client, storage, recoveryCode, id: decodeRecoveryCode(recoveryCode)!.userId };
    people.push(a);
    expect(await a.backend.getSession()).toEqual({ isMember: true });
    b = await newMember();
    people.push(b);
  });

  it('survives a lost response: signs in with the stored recovery code', async () => {
    const storage = memoryStorage();
    const client = createClient(stack().url, stack().anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          if (String(input instanceof Request ? input.url : input).includes('/functions/v1/redeem-invite')) {
            throw new TypeError('fetch failed');
          }
          return res;
        },
      },
    });
    const backend = createSupabaseBackend(client, storage);
    const { recoveryCode } = await backend.redeemInvite(await newInvite());
    expect(recoveryCode).toBe(storage.getItem(RECOVERY_CODE_KEY));
    people.push({ backend, client, storage, recoveryCode, id: decodeRecoveryCode(recoveryCode)!.userId });
    expect(await backend.getSession()).toEqual({ isMember: true });
  });

  it('keeps the original recovery code when a lost response is followed by a failed sign-in', async () => {
    const storage = memoryStorage();
    let phase: 'lose' | 'online' = 'lose';
    const client = createClient(stack().url, stack().anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = String(input instanceof Request ? input.url : input);
          if (phase === 'lose' && url.includes('grant_type=password')) throw new TypeError('fetch failed');
          const res = await fetch(input, init);
          if (phase === 'lose' && url.includes('/functions/v1/redeem-invite')) throw new TypeError('fetch failed');
          return res;
        },
      },
    });
    const backend = createSupabaseBackend(client, storage);
    const invite = await newInvite();
    const first = await backend.redeemInvite(invite).catch((e) => e);
    expect(first).toBeInstanceOf(BackendError);
    expect(first.code).toBe('network');
    const original = storage.getItem(RECOVERY_CODE_KEY)!;
    expect(decodeRecoveryCode(original)).not.toBeNull();

    phase = 'online';
    const { recoveryCode } = await backend.redeemInvite(invite);
    expect(recoveryCode).toBe(original);
    expect(storage.getItem(RECOVERY_CODE_KEY)).toBe(original);
    expect(await backend.getSession()).toEqual({ isMember: true });
    const id = decodeRecoveryCode(original)!.userId;
    people.push({ backend, client, storage, recoveryCode, id });
    const fresh = createSupabaseBackend(anonClient(), memoryStorage());
    await fresh.recover(original);
    expect(await fresh.getSession()).toEqual({ isMember: true });
  });

  it('reports an invalid invite as a BackendError and keeps no recovery code', async () => {
    const storage = memoryStorage();
    const backend = createSupabaseBackend(anonClient(), storage);
    const err = await backend.redeemInvite('NOSUCHCODE').catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('invalid_invite');
    expect(storage.getItem(RECOVERY_CODE_KEY)).toBeNull();
  });

  it('recovers the same user on a fresh client', async () => {
    const client = anonClient();
    const backend = createSupabaseBackend(client, memoryStorage());
    await backend.recover(a.recoveryCode);
    expect(await backend.getSession()).toEqual({ isMember: true });
    expect((await client.auth.getSession()).data.session?.user.id).toBe(a.id);
    const bad = await createSupabaseBackend(anonClient(), memoryStorage()).recover('nonsense').catch((e) => e);
    expect(bad.code).toBe('bad_code');
  });

  it('loadMap counts match the seed', async () => {
    const map = await a.backend.loadMap();
    const count = async (t: string) =>
      (await admin.from(t).select('*', { count: 'exact', head: true })).count!;
    expect(map.stars.length).toBe(
      (await admin.from('songs').select('*', { count: 'exact', head: true }).eq('status', 'active')).count!,
    );
    expect(map.regions.length).toBe(await count('regions'));
    expect(map.docks.length).toBe(
      (await admin.from('docks').select('*', { count: 'exact', head: true })).count!,
    );
    expect(map.stars.length).toBeGreaterThan(50);
    expect(map.stars[0]).toMatchObject({ regionId: expect.any(Number), title: expect.any(String) });
    expect(map.docks.every((d) => d.isSample)).toBe(true);
    songs = map.stars;
  });

  it('getSongs and searchSongs return songs', async () => {
    const got = await a.backend.getSongs([songs[0].id, songs[1].id]);
    expect(got.map((s) => s.id).sort()).toEqual([songs[0].id, songs[1].id].sort());
    const first = (await a.backend.getSongs([songs[0].id]))[0];
    const found = await a.backend.searchSongs(first.title);
    expect(found.some((s) => s.id === first.id)).toBe(true);
    expect(await a.backend.searchSongs('x')).toEqual([]);
  });

  it('profile, ship colour, home and dock', async () => {
    const colour = (await import('../../supabase/functions/_shared/core/palette.ts')).SHIP_COLOURS[3];
    await a.backend.setShipColour(colour);
    await a.backend.setHome(songs[5].id);
    const p = await a.backend.getProfile();
    expect(p).toMatchObject({ shipColour: colour, homeSongId: songs[5].id });
    expect(p.colourSeed).toMatch(/^[0-9a-f]{16}$/);

    expect(await a.backend.getMyDock()).toBeNull();
    aDock = await a.backend.setDock(songs[10].id);
    expect(await a.backend.getMyDock()).toEqual({ id: aDock, songId: songs[10].id });
    expect((await a.backend.loadMap()).docks.some((d) => d.id === aDock && !d.isSample)).toBe(true);
    expect((await a.backend.setShipColour('#123456').catch((e) => e)).code).toBe('bad_colour');
  });

  it('journey: start, hitchhike, moveTo root, branch', async () => {
    expect(await a.backend.currentJourney('UTC')).toBeNull();
    const j = await a.backend.startJourney('UTC', songs[0].id);
    expect(j.hops).toHaveLength(1);
    expect(j.currentHopId).toBe(j.hops[0].id);
    const root = j.hops[0];
    expect(root).toMatchObject({ parentHopId: null, kind: 'start', songId: songs[0].id });

    const h1 = await a.backend.hop('UTC', root.id, songs[1].id, 'hitchhike');
    expect(h1).toMatchObject({ parentHopId: root.id, songId: songs[1].id, kind: 'hitchhike' });
    await a.backend.moveTo('UTC', root.id);
    const h2 = await a.backend.hop('UTC', root.id, songs[2].id, 'jump');

    const cur = (await a.backend.currentJourney('UTC'))!;
    expect(cur.id).toBe(j.id);
    expect(cur.currentHopId).toBe(h2.id);
    expect(cur.hops).toHaveLength(3);
    const byId = new Map(cur.hops.map((h) => [h.id, h]));
    expect(byId.get(root.id)!.parentHopId).toBeNull();
    expect(byId.get(h1.id)!.parentHopId).toBe(root.id);
    expect(byId.get(h2.id)!.parentHopId).toBe(root.id);
    expect(byId.get(h2.id)!.kind).toBe('jump');
  });

  it('surfaces RPC errors as BackendError with the code', async () => {
    const err = await a.backend.startJourney('UTC', songs[0].id).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('journey_exists');
    expect((await a.backend.hop('UTC', crypto.randomUUID(), songs[0].id, 'jump').catch((e) => e)).code).toBe('bad_hop');
  });

  it('maps a network failure to BackendError("network")', async () => {
    const dead = createSupabaseBackend(
      createClient('http://127.0.0.1:1', 'x', { auth: { persistSession: false, autoRefreshToken: false } }),
      memoryStorage(),
    );
    const err = await dead.loadMap().catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('network');
  });

  it('likes, traces and the inbox', async () => {
    const colourA = (await a.backend.getProfile()).shipColour;
    expect(await b.backend.getTraces()).toEqual([]);
    const traceId = await b.backend.likeDock(aDock);
    expect(traceId).not.toBeNull();
    const traces = await b.backend.getTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ id: traceId, shipColour: colourA, originSongId: songs[10].id });
    expect(await b.backend.findTrace(traceId!)).toBe(songs[10].id);
    expect((await a.backend.likeDock(aDock).catch((e) => e)).code).toBe('own_dock');

    const inboxA = await a.backend.getInbox();
    expect(inboxA.filter((i) => i.kind === 'kept')).toHaveLength(1);
    expect(inboxA[0]).toMatchObject({ kind: 'kept', songId: songs[10].id, shipColour: null, seenAt: null });

    await b.backend.sendSuggestion(traceId!, songs[20].id);
    const after = await a.backend.getInbox();
    const sug = after.find((i) => i.kind === 'suggestion')!;
    expect(sug).toMatchObject({ songId: songs[20].id, seenAt: null });
    expect(sug.replyTraceId).not.toBeNull();

    await a.backend.markInboxSeen();
    expect((await a.backend.getInbox()).every((i) => i.seenAt !== null)).toBe(true);
  });
});
