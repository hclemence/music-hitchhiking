import { defineConfig, devices } from '@playwright/test';
import { stack } from '../tests/integration/stack.ts';

/**
 * Two projects:
 * - `live`: the whole flow for two people against the local Supabase stack (seeded with
 *   `pnpm seed:sample`, `pnpm functions:serve` running). Starts its own Vite dev server in live mode.
 * - `demo`: opens the single-file demo build (`pnpm app:build:demo`) with the network blocked.
 */
const LIVE_PORT = 5199;
// Only the live project needs the stack: `--project=demo` (or `--project demo`) runs without it.
const argv = process.argv.join(' ');
const runsLive = !/--project[= ]demo\b/.test(argv) || /--project[= ]live\b/.test(argv);
const s = runsLive ? stack() : null;

const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: false,
  // SwiftShader renders on the CPU: two live WebGL pages at 2x are too slow.
  deviceScaleFactor: 1,
};

const webgl = {
  // Headless Chromium has no GPU: render WebGL with SwiftShader.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

export default defineConfig({
  testDir: './e2e',
  timeout: 420_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    ...phone,
    launchOptions: webgl,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'live', testMatch: /live-flow\.spec\.ts/, use: { baseURL: `http://localhost:${LIVE_PORT}` } },
    { name: 'demo', testMatch: /demo-offline\.spec\.ts/ },
  ],
  webServer: s
    ? {
        command: `pnpm exec vite --port ${LIVE_PORT} --strictPort`,
        url: `http://localhost:${LIVE_PORT}`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { VITE_SUPABASE_URL: s.url, VITE_SUPABASE_ANON_KEY: s.anonKey, VITE_BACKEND: 'live' },
      }
    : undefined,
});
