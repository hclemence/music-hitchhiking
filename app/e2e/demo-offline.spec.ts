import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The single-file demo build (`pnpm app:build:demo`) opened straight from disk with every
 * non-local request aborted: first run goes Ship → Dock → Start from home and reaches the map.
 */

const FILE = fileURLToPath(new URL('../dist-demo/index.html', import.meta.url));
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? fileURLToPath(new URL('../test-results/e2e-screens', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const LOCAL = /^(file|data|blob):/;

test('demo build reaches the map with the network blocked', async ({ page }) => {
  expect(existsSync(FILE), `${FILE} missing: run pnpm app:build:demo`).toBe(true);
  expect(statSync(FILE).size).toBeLessThan(16 * 1024 * 1024);

  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (LOCAL.test(url)) return route.continue();
    blocked.push(url);
    return route.abort('internetdisconnected');
  });
  // Requests that never reach the router (e.g. a WebSocket) still show up here.
  page.on('request', (r) => { if (!LOCAL.test(r.url()) && !blocked.includes(r.url())) blocked.push(r.url()); });
  page.on('websocket', (ws) => blocked.push(ws.url()));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(pathToFileURL(FILE).href);
  await expect(page).toHaveTitle('Music Hitchhiking');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);

  // First run in demo: no invite, straight to Ship then Dock.
  await expect(page.getByRole('heading', { name: 'Choose your ship' })).toBeVisible();
  await page.getByRole('button', { name: /^Colour 5 of \d+$/ }).click();
  await page.screenshot({ path: join(SHOTS, 'e2e-demo-01-ship.png') });
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Choose your dock' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search songs or artists' }).fill('Stairway');
  const result = page.locator('.results button').filter({ hasText: 'Stairway to Heaven' }).first();
  await expect(result).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'e2e-demo-02-dock.png') });
  await result.click();

  await expect(page.getByRole('heading', { name: 'Where do you want to start today?' })).toBeVisible();
  await page.getByRole('button', { name: 'Start from home' }).click();

  const here = page.getByLabel('You are here').locator('.now-title');
  await expect(here).toHaveText('Stairway to Heaven');
  await expect(page.locator('canvas')).toBeVisible();
  // About 1.5 s after arriving, the nearest ship flies over and its pop-up opens.
  const popup = page.getByRole('dialog', { name: "You've encountered someone" });
  await expect(popup).toBeVisible({ timeout: 15000 });
  await expect(popup.getByText('Sample')).toBeVisible();
  // Demo has no other people: no History or Inbox.
  const toolbar = page.getByRole('navigation', { name: 'Actions' });
  await expect(toolbar.getByRole('button', { name: 'History' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: /^Inbox/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: join(SHOTS, 'e2e-demo-03-map.png') });

  // Double-tap focus: the camera orbits the current star, which sits at the canvas centre, so a
  // double tap there picks a star and makes it the focus. No hop is made.
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.touchscreen.tap(cx, cy);
  await page.touchscreen.tap(cx, cy);
  await expect(canvas).toHaveAttribute('data-focus-song-id', /^[0-9a-f-]{36}$/);
  await expect(here).toHaveText('Stairway to Heaven');

  // One hitchhike, to see the flight land.
  const title = (await popup.locator('h3').textContent())!;
  await popup.getByRole('button', { name: 'Hitchhike' }).click();
  await expect(here).toHaveText(title);
  await expect(toolbar.getByRole('button', { name: 'Wait' })).toBeEnabled();
  await page.screenshot({ path: join(SHOTS, 'e2e-demo-04-hitchhiked.png') });

  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
});
