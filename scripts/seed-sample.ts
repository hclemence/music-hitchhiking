import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { stack } from '../tests/integration/stack.ts';
import type { SampleMap } from './sample-map.ts';

/** Upsert in chunks so a request body stays small. */
async function upsertChunks(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const conn = url && key ? { url, serviceKey: key } : stack();
  const db = createClient(conn.url, conn.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const map = JSON.parse(readFileSync(new URL('../data/sample-map.json', import.meta.url), 'utf8')) as SampleMap;

  await upsertChunks(db, 'regions', map.regions.map((r) => ({ id: r.id, x: r.x, y: r.y, z: r.z, adjacent: r.adjacent })));
  await upsertChunks(db, 'songs', map.songs.map((s) => ({
    id: s.id, mbid: s.mbid, title: s.title, artist: s.artist, x: s.x, y: s.y, z: s.z,
    region_id: s.regionId, local_radius: s.localRadius,
    spotify_url: s.spotifyUrl, apple_url: s.appleUrl, youtube_url: s.youtubeUrl, origin: 'seed',
  })));
  await upsertChunks(db, 'docks', map.docks.map((d) => ({
    id: d.id, user_id: null, song_id: d.songId, is_sample: true, ship_colour: d.shipColour,
  })));
  const { error } = await db.rpc('tick_brightness');
  if (error) throw new Error(`tick_brightness: ${error.message}`);
  console.log(`Seeded ${map.regions.length} regions, ${map.songs.length} songs, ${map.docks.length} sample docks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
