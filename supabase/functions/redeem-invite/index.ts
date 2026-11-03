import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  encodeRecoveryCode,
  hashInviteCode,
  recoveryEmail,
  secretFromBase32,
  secretToBase32,
} from '../_shared/core/recovery.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

// Postgres error codes redeem_invite can raise when the caller already has a profile.
const UNIQUE_VIOLATION = '23505';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Who is calling? Only ever act on the account the verified token belongs to.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'unauthorized' });
  const anon = createClient(url, anonKey, clientOptions);
  const { data: auth, error: authError } = await anon.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'unauthorized' });
  const userId = auth.user.id;

  let code: unknown;
  let secretText: unknown;
  try {
    ({ code, secret: secretText } = await req.json());
  } catch {
    code = undefined;
  }
  if (typeof code !== 'string' || code.trim() === '') return json(400, { error: 'invalid_invite' });
  // The client generated the secret and has already stored its recovery code, so a lost response
  // cannot lose the account. The password is the secret itself.
  const secret = typeof secretText === 'string' ? secretFromBase32(secretText) : null;
  if (!secret) return json(400, { error: 'bad_secret' });
  const password = secretToBase32(secret);
  const recoveryCode = encodeRecoveryCode(userId, secret);

  const admin = createClient(url, serviceKey, clientOptions);
  const credentials = { email: recoveryEmail(userId), password, email_confirm: true };

  const existing = await admin.from('profiles').select('user_id').eq('user_id', userId).maybeSingle();
  if (existing.error) return json(500, { error: 'server_error' });
  if (existing.data) {
    // Members stay members; do not spend an invite on them. But a member whose auth user has no
    // email yet (a crash between claiming the invite and setting credentials) finishes setup.
    const user = await admin.auth.admin.getUserById(userId);
    if (user.error || !user.data.user) return json(500, { error: 'server_error' });
    if (user.data.user.email) return json(400, { error: 'already_member' });
    const finished = await admin.auth.admin.updateUserById(userId, credentials);
    if (finished.error) {
      console.error(`redeem-invite: finishing setup failed for ${userId}: ${finished.error.message}`);
      return json(500, { error: 'server_error' });
    }
    return json(200, { recoveryCode });
  }

  const codeHash = await hashInviteCode(code);
  const redeemed = await admin.rpc('redeem_invite', { p_user_id: userId, p_code_hash: codeHash });
  if (redeemed.error) {
    // Lost a race against another redemption by the same user.
    if (redeemed.error.code === UNIQUE_VIOLATION) return json(400, { error: 'already_member' });
    return json(500, { error: 'server_error' });
  }
  if (redeemed.data !== true) return json(400, { error: 'invalid_invite' });

  // Turn the anonymous user into a recoverable account: synthetic email + the client's secret.
  const updated = await admin.auth.admin.updateUserById(userId, credentials);
  if (updated.error) {
    console.error(`redeem-invite: setting credentials failed for ${userId}: ${updated.error.message}`);
    // Undo: no profile, invite usable again. Only free the invite if the profile is really gone,
    // otherwise the member would be left with a spendable invite and no way to retry.
    const profile = await admin.from('profiles').delete().eq('user_id', userId);
    if (profile.error) {
      console.error(`redeem-invite: rollback incomplete for ${userId}, profile not deleted: ${profile.error.message}`);
    } else {
      const invite = await admin
        .from('invites')
        .update({ redeemed_by: null, redeemed_at: null })
        .eq('code_hash', codeHash)
        .eq('redeemed_by', userId);
      if (invite.error) console.error(`redeem-invite: rollback incomplete for ${userId}, invite not freed: ${invite.error.message}`);
    }
    return json(500, { error: 'server_error' });
  }

  return json(200, { recoveryCode });
});
