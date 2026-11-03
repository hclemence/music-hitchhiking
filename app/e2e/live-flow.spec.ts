import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient } from '../../tests/integration/stack.ts';
import { generateInviteCode, hashInviteCode } from '../../supabase/functions/_shared/core/recovery.ts';
import { SHIP_COLOURS } from '../../supabase/functions/_shared/core/palette.ts';
import { findEncounters } from '../../supabase/functions/_shared/core/encounters.ts';
import { seededRng } from '../../supabase/functions/_shared/core/rng.ts';
import type { PublicDock, Star } from '../../supabase/functions/_shared/core/types.ts';
import type { SampleMap } from '../../scripts/sample-map.ts';

/**
 * The whole live flow for two people at phone size, against the local stack (seeded with
 * `pnpm seed:sample`, `pnpm functions:serve` running). Nothing is mocked.
 *
 * Making A's dock one of B's encounters deterministically: encounters are a seeded shuffle of the
 * docks near the current song. The test picks A's dock song X and B's start song Y (X's nearest
 * song) from the sample map by running core `findEncounters` at Y over the sample docks plus a
 * stand-in for A's dock at X, and keeps the first pair where A's dock is shown for every one of 64
 * shuffle seeds (in practice: the ring that decides holds A's dock and exactly one other). B then
 * starts the day at Y with "Start somewhere else", so on a freshly seeded stack A's ship is among
 * B's first encounters. Real docks left by other runs could crowd that ring, so B may also press
 * Wait (each Wait shows docks not yet shown at this hop) a bounded number of times.
 */

type SampleSong = SampleMap['songs'][number];

const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? fileURLToPath(new URL('../test-results/e2e-screens', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const map = JSON.parse(readFileSync(new URL('../../data/sample-map.json', import.meta.url), 'utf8')) as SampleMap;
const dist = (a: SampleSong, b: SampleSong) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Titles that are easy to search for and match exactly. */
const plain = (s: SampleSong) => /^[A-Za-z0-9 ]+$/.test(s.title) && s.title.length >= 4;
const star = (s: SampleSong): Star => ({ ...s, brightness: 1 });
const stars = new Map(map.songs.map((s) => [s.id, star(s)]));
const sampleDocks: PublicDock[] = map.docks.map((d) => ({
  id: d.id, songId: d.songId, isSample: true, shipColour: d.shipColour, updatedAt: '1970-01-01T00:00:00Z',
}));
const sampleDocked = new Set(map.docks.map((d) => d.songId));

function nearest(to: SampleSong, except: ReadonlySet<string>): SampleSong {
  return map.songs.filter((s) => !except.has(s.id) && plain(s)).sort((a, b) => dist(a, to) - dist(b, to))[0]!;
}
function farthest(from: SampleSong, except: ReadonlySet<string>): SampleSong {
  return map.songs.filter((s) => !except.has(s.id) && plain(s)).sort((a, b) => dist(b, from) - dist(a, from))[0]!;
}

/** Whether a dock at `x` is among the first encounters at `y`, whatever the shuffle seed. */
function alwaysMet(x: SampleSong, y: SampleSong): boolean {
  const mine: PublicDock = { id: 'a', songId: x.id, isSample: false, shipColour: '#000000', updatedAt: new Date().toISOString() };
  for (let seed = 0; seed < 64; seed++) {
    const found = findEncounters({
      current: star(y), stars, docks: [...sampleDocks, mine], ownDockId: null,
      pathSongIds: new Set([y.id]), seenDockIds: new Set(), rng: seededRng(`e2e:${seed}`),
    });
    if (!found.some((e) => e.dock.id === 'a')) return false;
  }
  return true;
}

/** X: A's dock (a song with no sample dock). Y: B's start, X's nearest song. */
const pick = (() => {
  for (const x of map.songs) {
    if (sampleDocked.has(x.id) || !plain(x)) continue;
    const y = nearest(x, new Set([x.id]));
    if (alwaysMet(x, y)) return { x, y };
  }
  throw new Error('no song pair where A\'s dock is always met');
})();
const X = pick.x;
const Y = pick.y;
const Z = farthest(Y, new Set([X.id, Y.id])); // B's dock, far from everything in the test
const S = nearest(Z, new Set([X.id, Y.id, Z.id])); // B sends A this song
const R = nearest(X, new Set([X.id, Y.id, Z.id, S.id])); // A replies with this one

const A_COLOUR = 3; // 1-based, as in the swatch labels
const B_COLOUR = 8;

const admin = adminClient();
const inviteHashes: string[] = [];
const userIds: string[] = [];

async function newInvite(): Promise<string> {
  const code = generateInviteCode();
  const code_hash = await hashInviteCode(code);
  const { error } = await admin.from('invites').insert({
    code_hash, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (error) throw error;
  inviteHashes.push(code_hash);
  return code;
}

async function userIdOf(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.endsWith('-auth-token')) return (JSON.parse(localStorage.getItem(k)!) as { user: { id: string } }).user.id;
    }
    return null;
  });
  if (!id) throw new Error('no session in storage');
  return id;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `e2e-${name}.png`) });
}

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const encounters = (page: Page) => page.getByRole('region', { name: 'Encounters' });
const cards = (page: Page) => encounters(page).locator('article.card');
const hereTitle = (page: Page) => page.getByLabel('You are here').locator('.now-title');
const stops = (page: Page, n: number) => page.getByRole('button', { name: `Route map, ${n} ${n === 1 ? 'stop' : 'stops'}` });

/** Search in a SongSearch / StartChoice box and pick the row for `song`. */
async function chooseSong(scope: Page | Locator, song: SampleSong) {
  await scope.getByRole('searchbox', { name: 'Search songs or artists' }).fill(song.title);
  await scope.locator('.results button').filter({ hasText: song.title }).filter({ hasText: song.artist }).first().click();
}

/** Waits until a hop has landed: no flight, no pending hop (Wait and Hitchhike are enabled again). */
async function settled(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: 'Wait' })).toBeEnabled();
  await expect(cards(page).first().getByRole('button', { name: 'Hitchhike' })).toBeEnabled();
}

/** Invite → recovery code → ship colour → dock (also home). Ends on "Where do you want to start today?". */
async function onboard(page: Page, who: string, colour: number, dock: SampleSong) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Music Hitchhiking' })).toBeVisible();
  await shot(page, `${who}-01-start`);
  await page.getByRole('button', { name: 'I have an invite' }).click();
  await page.getByLabel('Invite code').fill(await newInvite());
  await shot(page, `${who}-02-invite`);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Your recovery code' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Recovery code' })).toHaveText(/[A-Z0-9]{4}( [A-Z0-9]{1,4})+/);
  await shot(page, `${who}-03-recovery-code`);
  await page.getByRole('button', { name: "I've saved it" }).click();
  userIds.push(await userIdOf(page));

  await expect(page.getByRole('heading', { name: 'Choose your ship' })).toBeVisible();
  const swatch = page.getByRole('button', { name: new RegExp(`^Colour ${colour} of \\d+$`) });
  await swatch.click();
  await expect(swatch).toHaveAttribute('aria-pressed', 'true');
  await shot(page, `${who}-04-ship`);
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Choose your dock' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Also make this home' })).toBeChecked();
  await page.getByRole('searchbox', { name: 'Search songs or artists' }).fill(dock.title);
  await expect(page.locator('.results button').filter({ hasText: dock.artist }).first()).toBeVisible();
  await shot(page, `${who}-05-dock-search`);
  await page.locator('.results button').filter({ hasText: dock.title }).filter({ hasText: dock.artist }).first().click();

  await expect(page.getByRole('heading', { name: 'Where do you want to start today?' })).toBeVisible();
  await shot(page, `${who}-06-start-choice`);
}

async function hitchhikeFirst(page: Page, stopsAfter: number) {
  await settled(page);
  const card = cards(page).first();
  const title = (await card.locator('h3').textContent())!;
  await card.getByRole('button', { name: 'Hitchhike' }).click();
  await expect(hereTitle(page)).toHaveText(title);
  await expect(stops(page, stopsAfter)).toBeVisible();
  await settled(page);
}

async function phone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  return { context, page };
}

test.afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  if (inviteHashes.length) await admin.from('invites').delete().in('code_hash', inviteHashes);
});

test('two people: explore, like, trace, suggestion and reply', async ({ browser }) => {
  test.info().annotations.push({
    type: 'songs',
    description: `A docks at "${X.title}", B starts at "${Y.title}", B docks at "${Z.title}"`,
  });
  console.log(`A docks at "${X.title}" by ${X.artist}; B starts at "${Y.title}" by ${Y.artist}; B docks at "${Z.title}"`);

  // ---- A: onboard and explore ----
  const a = await phone(browser);
  await onboard(a.page, 'a', A_COLOUR, X);
  await a.page.getByRole('button', { name: 'Start from home' }).click();
  await expect(hereTitle(a.page)).toHaveText(X.title);
  await expect(stops(a.page, 1)).toBeVisible();
  await expect(cards(a.page)).not.toHaveCount(0);
  await expect(a.page.locator('canvas')).toBeVisible();
  // Phone first: no horizontal page scroll.
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(a.page, 'a-07-explore');

  const aId = userIds[0]!;
  const { data: aDock, error: dockErr } = await admin.from('docks').select('id, song_id, ship_colour').eq('user_id', aId).single();
  expect(dockErr).toBeNull();
  expect(aDock!.song_id).toBe(X.id);
  expect(aDock!.ship_colour.toLowerCase()).toBe(SHIP_COLOURS[A_COLOUR - 1]!.toLowerCase());

  // Hitchhike three times.
  await hitchhikeFirst(a.page, 2);
  await hitchhikeFirst(a.page, 3);
  await hitchhikeFirst(a.page, 4);
  await shot(a.page, 'a-08-after-3-hitchhikes');

  // Tap the root on the mini-map: back home with no new hop.
  await stops(a.page, 4).click();
  const route = a.page.getByRole('dialog', { name: 'Your route today' });
  await expect(route).toBeVisible();
  await shot(a.page, 'a-09-route-sheet');
  await route.getByRole('button', { name: `Go back to ${X.title} by ${X.artist}` }).click();
  await expect(route).toBeHidden();
  await expect(hereTitle(a.page)).toHaveText(X.title);
  await expect(stops(a.page, 4)).toBeVisible();

  // Hitchhike from the root: a branch.
  await hitchhikeFirst(a.page, 5);
  const { data: journey } = await admin.from('journeys').select('id').eq('user_id', aId).single();
  const { data: hops, error: hopsErr } = await admin.from('hops').select('id, parent_hop_id, kind')
    .eq('journey_id', journey!.id);
  expect(hopsErr).toBeNull();
  expect(hops).toHaveLength(5);
  const root = hops!.find((h) => h.kind === 'start')!;
  expect(hops!.filter((h) => h.parent_hop_id === root.id)).toHaveLength(2);
  await shot(a.page, 'a-10-branch');

  // Like an encounter.
  const likeCard = cards(a.page).first();
  const liked = a.page.waitForResponse((r) => r.url().includes('/rpc/like_dock') && r.ok());
  await likeCard.getByRole('button', { name: 'Like' }).click();
  await expect(likeCard.getByRole('button', { name: 'Kept' })).toBeDisabled();
  await liked;
  await shot(a.page, 'a-11-liked');

  // ---- B: onboard, start next to A's dock, find A's ship ----
  const b = await phone(browser);
  await onboard(b.page, 'b', B_COLOUR, Z);
  await b.page.getByRole('button', { name: 'Start somewhere else' }).click();
  await chooseSong(b.page, Y);
  await expect(hereTitle(b.page)).toHaveText(Y.title);

  const aCard = cards(b.page).and(b.page.locator(`[data-dock-id="${aDock!.id}"]`));
  let waits = 0;
  for (; waits < 40 && (await aCard.count()) === 0; waits++) {
    await b.page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: 'Wait' }).click();
    await b.page.waitForTimeout(250);
  }
  test.info().annotations.push({ type: 'waits', description: `B pressed Wait ${waits} time(s) before A's ship appeared` });
  console.log(`B pressed Wait ${waits} time(s) before A's ship appeared`);
  await expect(aCard).toBeVisible();
  await expect(aCard).toHaveAccessibleName(`${X.title} by ${X.artist}`);
  await expect(aCard.locator('[data-swatch]')).toHaveCSS('background-color', rgb(SHIP_COLOURS[A_COLOUR - 1]!));
  await expect(aCard.getByText('Sample')).toHaveCount(0);
  expect((await aCard.locator('[data-swatch]').boundingBox())!.width).toBeLessThan(30); // a dot, not a bar
  await aCard.scrollIntoViewIfNeeded();
  await shot(b.page, 'b-07-encounter-a');

  const bLiked = b.page.waitForResponse((r) => r.url().includes('/rpc/like_dock') && r.ok());
  await aCard.getByRole('button', { name: 'Like' }).click();
  await expect(aCard.getByRole('button', { name: 'Kept' })).toBeDisabled();
  await bLiked;

  // History shows A's ship; send A a song.
  await b.page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: 'History' }).click();
  const history = b.page.getByRole('dialog', { name: 'History' });
  const trace = history.locator('li.row').filter({ hasText: X.title });
  await expect(trace).toBeVisible();
  await expect(trace.locator('.ship-dot')).toHaveCSS('background-color', rgb(SHIP_COLOURS[A_COLOUR - 1]!));
  await shot(b.page, 'b-08-history');
  await trace.getByRole('button', { name: 'Send a song' }).click();
  await expect(history.getByRole('heading', { name: `Send a song to ${X.title}'s ship` })).toBeVisible();
  await chooseSong(history, S);
  await expect(history.getByRole('status')).toHaveText('Sent');
  await shot(b.page, 'b-09-sent');
  await history.getByRole('button', { name: 'Close' }).click();

  // ---- A: reload, inbox dot, suggestion, reply ----
  await a.page.reload();
  await expect(hereTitle(a.page)).toBeVisible();
  const aInboxBtn = a.page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: 'Inbox (new)' });
  await expect(aInboxBtn).toBeVisible();
  await shot(a.page, 'a-12-inbox-dot');
  await aInboxBtn.click();
  const aInbox = a.page.getByRole('dialog', { name: 'Inbox' });
  const suggestion = aInbox.locator('li.row').filter({ hasText: S.title });
  await expect(suggestion).toContainText(S.artist);
  await expect(suggestion.locator('.ship-dot')).toHaveCSS('background-color', rgb(SHIP_COLOURS[B_COLOUR - 1]!));
  await expect(aInbox.getByText(`Someone kept your song: ${X.title}`)).toBeVisible();
  await shot(a.page, 'a-13-inbox');
  await suggestion.getByRole('button', { name: 'Reply' }).click();
  await expect(aInbox.getByRole('heading', { name: 'Reply with a song' })).toBeVisible();
  await chooseSong(aInbox, R);
  await expect(aInbox.getByRole('status')).toHaveText('Sent');
  await shot(a.page, 'a-14-replied');

  // ---- B: the reply arrives ----
  await b.page.reload();
  await expect(hereTitle(b.page)).toHaveText(Y.title);
  const bInboxBtn = b.page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: 'Inbox (new)' });
  await expect(bInboxBtn).toBeVisible();
  await bInboxBtn.click();
  const bInbox = b.page.getByRole('dialog', { name: 'Inbox' });
  const reply = bInbox.locator('li.row').filter({ hasText: R.title });
  await expect(reply).toContainText(R.artist);
  await expect(reply.locator('.ship-dot')).toHaveCSS('background-color', rgb(SHIP_COLOURS[A_COLOUR - 1]!));
  await shot(b.page, 'b-10-inbox-reply');

  await a.context.close();
  await b.context.close();
});
