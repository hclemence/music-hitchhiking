import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config.ts';

/**
 * Single-file demo build: DemoBackend over the embedded sample map, no Supabase, no network.
 * Output: dist-demo/index.html (everything inlined), for publishing as one page.
 */
export default mergeConfig(base, defineConfig({
  mode: 'production',
  plugins: [viteSingleFile()],
  define: {
    // Fixed at build time so the live backend branch (and supabase-js) is dropped from the bundle.
    'import.meta.env.VITE_BACKEND': JSON.stringify('demo'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 16_000,
  },
}));
