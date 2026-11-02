import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Stack {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let cached: Stack | undefined;

/** Connection details for the local stack: env vars if all set, else `supabase status -o env`. */
export function stack(): Stack {
  if (cached) return cached;
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY) {
    cached = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, serviceKey: SUPABASE_SERVICE_ROLE_KEY };
    return cached;
  }
  const out = execSync('pnpm --silent supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error('Local stack not running? Start it with `pnpm db:start`.');
  }
  cached = { url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY };
  return cached;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): SupabaseClient {
  return createClient(stack().url, stack().anonKey, opts);
}

export function adminClient(): SupabaseClient {
  return createClient(stack().url, stack().serviceKey, opts);
}
