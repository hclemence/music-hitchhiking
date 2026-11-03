import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateInviteCode,
  hashInviteCode,
  recoveryEmail,
  secretToBase32,
} from '../../supabase/functions/_shared/core/recovery.ts';
import { adminClient, anonClient, stack } from './stack.ts';

const admin = adminClient();
const createdUsers: string[] = [];
const createdHashes: string[] = [];

interface Person {
  client: SupabaseClient;
  id: string;
  token: string;
}

async function newAnonymousUser(): Promise<Person> {
  const client = anonClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session || !data.user) throw error ?? new Error('no session');
  createdUsers.push(data.user.id);
  return { client, id: data.user.id, token: data.session.access_token };
}

async function newInvite(opts: { expiresInMs?: number } = {}): Promise<string> {
  const code = generateInviteCode();
  const code_hash = await hashInviteCode(code);
  const expires_at = new Date(Date.now() + (opts.expiresInMs ?? 7 * 86_400_000)).toISOString();
  const { error } = await admin.from('invites').insert({ code_hash, expires_at });
  if (error) throw error;
  createdHashes.push(code_hash);
  return code;
}

async function redeem(token: string | null, body: unknown = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    apikey: stack().anonKey,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${stack().url}/functions/v1/redeem-invite`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as Record<string, unknown> | null };
}

/** What the client does first: make the secret, build and keep the recovery code, then send the secret. */
function newSecret(userId: string): { secret: string; recoveryCode: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return { secret: secretToBase32(bytes), recoveryCode: encodeRecoveryCode(userId, bytes) };
}

async function signInWithCode(recoveryCode: string) {
  const decoded = decodeRecoveryCode(recoveryCode)!;
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: recoveryEmail(decoded.userId),
    password: decoded.secret,
  });
  return { client, error, userId: data.user?.id, token: data.session?.access_token };
}

async function isMember(p: Person): Promise<boolean> {
  const { data, error } = await p.client.from('profiles').select('user_id').eq('user_id', p.id);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
}

afterAll(async () => {
  if (createdHashes.length) await admin.from('invites').delete().in('code_hash', createdHashes);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
});

describe('redeem-invite', () => {
  it('redeems a valid code: 200 with a recovery code, profile exists, member views open', async () => {
    const person = await newAnonymousUser();
    expect(await isMember(person)).toBe(false);

    const code = await newInvite();
    const mine = newSecret(person.id);
    const res = await redeem(person.token, { code, secret: mine.secret });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body!)).toEqual(['recoveryCode']);
    expect(res.body!.recoveryCode).toBe(mine.recoveryCode);
    expect(decodeRecoveryCode(res.body!.recoveryCode as string)?.userId).toBe(person.id);

    expect(await isMember(person)).toBe(true);
    const stars = await person.client.from('active_stars').select('id');
    expect(stars.error).toBeNull();
    const journey = await person.client.rpc('current_journey', { p_tz: 'UTC' });
    expect(journey.error?.message).not.toBe('not_member');

    const { data: profile } = await admin.from('profiles').select('*').eq('user_id', person.id).single();
    expect(profile!.ship_colour).toBe('#e8554e');
    expect(profile!.colour_seed).toMatch(/^[0-9a-f]{16}$/);
    const { data: invite } = await admin
      .from('invites').select('redeemed_by, redeemed_at')
      .eq('code_hash', await hashInviteCode(code)).single();
    expect(invite!.redeemed_by).toBe(person.id);
    expect(invite!.redeemed_at).not.toBeNull();
  });

  it('accepts the code typed in lowercase with a hyphen and a space', async () => {
    const person = await newAnonymousUser();
    const code = await newInvite();
    const typed = `${code.slice(0, 4)}-${code.slice(4, 7)} ${code.slice(7)}`.toLowerCase();
    expect((await redeem(person.token, { code: typed, secret: newSecret(person.id).secret })).status).toBe(200);
  });

  it('rejects the same code from a second user with invalid_invite', async () => {
    const first = await newAnonymousUser();
    const second = await newAnonymousUser();
    const code = await newInvite();
    expect((await redeem(first.token, { code, secret: newSecret(first.id).secret })).status).toBe(200);

    const res = await redeem(second.token, { code, secret: newSecret(second.id).secret });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_invite' });
    expect(await isMember(second)).toBe(false);
  });

  it('rejects an expired code with invalid_invite', async () => {
    const person = await newAnonymousUser();
    const code = await newInvite({ expiresInMs: -60_000 });
    const res = await redeem(person.token, { code, secret: newSecret(person.id).secret });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_invite' });
    expect(await isMember(person)).toBe(false);
  });

  it('rejects unknown, empty and malformed codes with invalid_invite', async () => {
    const person = await newAnonymousUser();
    for (const body of [{ code: 'NOSUCHCODE', secret: newSecret(person.id).secret }, { code: '' }, { code: 42 }, {}, 'not json']) {
      const res = await redeem(person.token, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_invite' });
    }
    expect(await isMember(person)).toBe(false);
  });

  it('lets exactly one of two concurrent redeemers win', async () => {
    const a = await newAnonymousUser();
    const b = await newAnonymousUser();
    const code = await newInvite();
    const results = await Promise.all([redeem(a.token, { code, secret: newSecret(a.id).secret }), redeem(b.token, { code, secret: newSecret(b.id).secret })]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 400]);
    const loser = results.find((r) => r.status === 400)!;
    expect(loser.body).toEqual({ error: 'invalid_invite' });
    const members = [await isMember(a), await isMember(b)];
    expect(members.filter(Boolean)).toHaveLength(1);
  });

  it('rejects a member redeeming a second code with already_member, leaving that code usable', async () => {
    const person = await newAnonymousUser();
    const mine = newSecret(person.id);
    const first = await redeem(person.token, { code: await newInvite(), secret: mine.secret });
    expect(first.status).toBe(200);

    // Redeeming sets a password, which ends the anonymous session: sign back in with the recovery code.
    const signedIn = await signInWithCode(mine.recoveryCode);
    expect(signedIn.error).toBeNull();

    const second = await newInvite();
    const res = await redeem(signedIn.token!, { code: second, secret: newSecret(person.id).secret });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'already_member' });

    const { data: invite } = await admin
      .from('invites').select('redeemed_at').eq('code_hash', await hashInviteCode(second)).single();
    expect(invite!.redeemed_at).toBeNull();

    const other = await newAnonymousUser();
    expect((await redeem(other.token, { code: second, secret: newSecret(other.id).secret })).status).toBe(200);
  });

  it('recovery code signs a fresh client back in as the same user', async () => {
    const person = await newAnonymousUser();
    const mine = newSecret(person.id);
    const res = await redeem(person.token, { code: await newInvite(), secret: mine.secret });
    expect(res.status).toBe(200);

    const signedIn = await signInWithCode(res.body!.recoveryCode as string);
    expect(signedIn.error).toBeNull();
    expect(signedIn.userId).toBe(person.id);
    expect(await isMember({ client: signedIn.client, id: person.id, token: '' })).toBe(true);

    const decoded = decodeRecoveryCode(mine.recoveryCode)!;
    const wrong = await anonClient().auth.signInWithPassword({
      email: recoveryEmail(decoded.userId),
      password: '0000000000000000',
    });
    expect(wrong.error).not.toBeNull();
  });

  it('survives a lost response: the stored recovery code signs in as the same member', async () => {
    const person = await newAnonymousUser();
    const mine = newSecret(person.id); // stored on the device before the call
    const code = await newInvite();
    await redeem(person.token, { code, secret: mine.secret }); // response ignored, as if it never arrived

    const signedIn = await signInWithCode(mine.recoveryCode);
    expect(signedIn.error).toBeNull();
    expect(signedIn.userId).toBe(person.id);
    expect(await isMember({ client: signedIn.client, id: person.id, token: '' })).toBe(true);
  });

  it('finishes setup for a member without credentials (half-finished redeem)', async () => {
    const person = await newAnonymousUser();
    const code = await newInvite();
    // The crash case: the invite was claimed and the profile made, but credentials were never set.
    const claimed = await admin.rpc('redeem_invite', {
      p_user_id: person.id,
      p_code_hash: await hashInviteCode(code),
    });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toBe(true);

    const mine = newSecret(person.id);
    const res = await redeem(person.token, { code: await newInvite(), secret: mine.secret });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recoveryCode: mine.recoveryCode });

    const signedIn = await signInWithCode(mine.recoveryCode);
    expect(signedIn.error).toBeNull();
    expect(signedIn.userId).toBe(person.id);
    expect(await isMember({ client: signedIn.client, id: person.id, token: '' })).toBe(true);
  });

  it('does not spend the invite when finishing setup for a half-finished member', async () => {
    const person = await newAnonymousUser();
    const claimed = await admin.rpc('redeem_invite', {
      p_user_id: person.id,
      p_code_hash: await hashInviteCode(await newInvite()),
    });
    expect(claimed.data).toBe(true);
    const spare = await newInvite();
    expect((await redeem(person.token, { code: spare, secret: newSecret(person.id).secret })).status).toBe(200);
    const { data: invite } = await admin
      .from('invites').select('redeemed_at').eq('code_hash', await hashInviteCode(spare)).single();
    expect(invite!.redeemed_at).toBeNull();
  });

  it('rejects a missing or malformed secret with bad_secret and spends nothing', async () => {
    const person = await newAnonymousUser();
    const code = await newInvite();
    const good = newSecret(person.id).secret;
    for (const secret of [undefined, 42, '', good.slice(1), `${good}0`, good.toLowerCase(), 'U'.repeat(16)]) {
      const res = await redeem(person.token, { code, secret });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'bad_secret' });
    }
    expect(await isMember(person)).toBe(false);
    const { data: invite } = await admin
      .from('invites').select('redeemed_at').eq('code_hash', await hashInviteCode(code)).single();
    expect(invite!.redeemed_at).toBeNull();
    expect((await redeem(person.token, { code, secret: good })).status).toBe(200);
  });

  it('keeps an anonymous user who never redeemed out of the member views', async () => {
    const person = await newAnonymousUser();
    const stars = await person.client.from('active_stars').select('*');
    expect(stars.error).toBeNull();
    expect(stars.data).toEqual([]);
    const journey = await person.client.rpc('current_journey', { p_tz: 'UTC' });
    expect(journey.error?.message).toBe('not_member');
  });

  it('requires a signed-in user', async () => {
    expect((await redeem(null, { code: 'ABCDEFGHJK', secret: newSecret(crypto.randomUUID()).secret })).status).toBe(401);
    // The anon key is a valid JWT but not a user.
    expect((await redeem(stack().anonKey, { code: 'ABCDEFGHJK', secret: newSecret(crypto.randomUUID()).secret })).status).toBe(401);
    expect((await redeem('garbage.token.value', { code: 'ABCDEFGHJK', secret: newSecret(crypto.randomUUID()).secret })).status).toBe(401);
  });

  it('does not expose redeem_invite or the invites table to signed-in users', async () => {
    const person = await newAnonymousUser();
    const rpc = await person.client.rpc('redeem_invite', {
      p_user_id: person.id,
      p_code_hash: await hashInviteCode(await newInvite()),
    });
    expect(rpc.error).not.toBeNull();
    expect(await isMember(person)).toBe(false);
    const table = await person.client.from('invites').select('*');
    expect(table.error).not.toBeNull();
  });
});
