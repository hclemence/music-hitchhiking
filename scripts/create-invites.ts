// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm tsx scripts/create-invites.ts <count> [--days 30]
// Prints one invite code per line; only their hashes are stored.
import { createClient } from '@supabase/supabase-js';
import { generateInviteCode, hashInviteCode } from '../supabase/functions/_shared/core/recovery.ts';

function usage(message: string): never {
  console.error(`${message}\nUsage: pnpm tsx scripts/create-invites.ts <count> [--days 30]`);
  process.exit(1);
}

const args = process.argv.slice(2);
const daysAt = args.indexOf('--days');
let days = 30;
if (daysAt >= 0) {
  days = Number(args[daysAt + 1]);
  args.splice(daysAt, 2);
}
const count = Number(args[0]);
if (!Number.isInteger(count) || count < 1 || args.length !== 1) usage('count must be a positive integer');
if (!Number.isFinite(days) || days <= 0) usage('--days must be a positive number');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) usage('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

const codes = Array.from({ length: count }, () => generateInviteCode());
const rows = await Promise.all(codes.map(async (code) => ({
  code_hash: await hashInviteCode(code),
  expires_at: expiresAt,
})));

const { error } = await supabase.from('invites').insert(rows);
if (error) {
  console.error(`Could not store invites: ${error.message}`);
  process.exit(1);
}
for (const code of codes) console.log(code);
