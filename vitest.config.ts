import { defineConfig } from 'vitest/config';

// Core unit tests only. Integration tests need the local stack: see vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['supabase/functions/_shared/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
