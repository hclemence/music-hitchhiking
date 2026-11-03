import { chromium } from '@playwright/test';
import { createServer } from 'vite';

/**
 * Report-only performance probe (not part of `pnpm app:e2e`): `pnpm --filter app exec tsx e2e/perf.probe.ts`.
 * Starts Vite, opens `/?perf=1` (10,000 stars, 200 docks on the real MapScene) in headless Chromium
 * with SwiftShader and logs the average frame time over 5 s. SwiftShader is a CPU renderer: the
 * number is not a real-GPU result.
 */
const server = await createServer({ server: { port: 5198, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.PERF_DSF ?? 2) })).newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto('http://localhost:5198/?perf=1');
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(3000); // let shaders compile and the first frames settle
  // A string, so the transpiler adds no helpers to the code that runs in the page.
  const r = await page.evaluate(`new Promise((resolve) => {
    let frames = 0, worst = 0, last = performance.now();
    const start = last;
    const tick = (t) => {
      worst = Math.max(worst, t - last); last = t; frames++;
      if (t - start < 5000) requestAnimationFrame(tick);
      else resolve({ frames, avgMs: (t - start) / frames, worstMs: worst });
    };
    requestAnimationFrame(tick);
  })`) as { frames: number; avgMs: number; worstMs: number };
  console.log(`perf: ${r.frames} frames in 5 s, average ${r.avgMs.toFixed(1)} ms/frame (${(1000 / r.avgMs).toFixed(1)} fps), worst ${r.worstMs.toFixed(1)} ms`);
} finally {
  await browser.close();
  await server.close();
}
