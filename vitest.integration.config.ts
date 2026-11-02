import { defineConfig } from 'vitest/config';

// Needs the local stack (`pnpm db:start`). Connection details come from SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, or else from `supabase status -o env`.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
