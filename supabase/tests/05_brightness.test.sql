begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

-- fixtures (run as postgres). Each song gets only the visits its case lists.
-- T is the fixed "now" passed to tick_brightness.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');

insert into public.songs (id, mbid, title, artist, x, y, z, local_radius, spotify_url, apple_url, youtube_url, brightness, status, origin) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'dock 15d', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0.9, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'dock 16d', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0.9, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', 'hop 11d', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0.9, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c4', 'hop 12d', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0.9, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5', 'dock 72h', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000c6', 'three docks', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000c7', 'real dock only', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000c8', 'sample dock only', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c9', 'nothing', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0.9, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000ba', '00000000-0000-0000-0000-0000000000ca', 'old visit', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000cb', 'sample plus busy', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000bc', '00000000-0000-0000-0000-0000000000cc', 'real dock plus stale', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000bd', '00000000-0000-0000-0000-0000000000cd', 'mixed kinds', 'A', 0, 0, 0, 10, 's', 'a', 'y', 0, 'inactive', 'seed');

insert into public.visits (song_id, kind, created_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'dock', '2026-11-02 12:00+00'::timestamptz - interval '360 hours'),
  ('00000000-0000-0000-0000-0000000000b2', 'dock', '2026-11-02 12:00+00'::timestamptz - interval '384 hours'),
  ('00000000-0000-0000-0000-0000000000b3', 'hop',  '2026-11-02 12:00+00'::timestamptz - interval '264 hours'),
  ('00000000-0000-0000-0000-0000000000b4', 'hop',  '2026-11-02 12:00+00'::timestamptz - interval '288 hours'),
  ('00000000-0000-0000-0000-0000000000b5', 'dock', '2026-11-02 12:00+00'::timestamptz - interval '72 hours'),
  ('00000000-0000-0000-0000-0000000000b6', 'dock', '2026-11-02 12:00+00'),
  ('00000000-0000-0000-0000-0000000000b6', 'dock', '2026-11-02 12:00+00'),
  ('00000000-0000-0000-0000-0000000000b6', 'dock', '2026-11-02 12:00+00'),
  ('00000000-0000-0000-0000-0000000000ba', 'dock', '2026-11-02 12:00+00'::timestamptz - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000bb', 'dock', '2026-11-02 12:00+00'),
  ('00000000-0000-0000-0000-0000000000bb', 'dock', '2026-11-02 12:00+00'),
  ('00000000-0000-0000-0000-0000000000bc', 'hop',  '2026-11-02 12:00+00'::timestamptz - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000bd', 'like', '2026-11-02 12:00+00'::timestamptz - interval '72 hours'),
  ('00000000-0000-0000-0000-0000000000bd', 'start', '2026-11-02 12:00+00'::timestamptz - interval '72 hours');

insert into public.docks (user_id, song_id, is_sample, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b7', false, '#aaaaaa'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000bc', false, '#bbbbbb'),
  (null, '00000000-0000-0000-0000-0000000000b8', true, '#dddddd'),
  (null, '00000000-0000-0000-0000-0000000000bb', true, '#dddddd');

insert into public.traces (id, holder_id, target_id, origin_song_id, last_exchange_at, brightness) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '2026-11-02 12:00+00'::timestamptz - interval '7 days', 1),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '2026-11-02 12:00+00'::timestamptz - interval '23 days', 1),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', '2026-11-02 12:00+00'::timestamptz - interval '24 days', 1);

-- privileges and shape
select has_function('public', 'tick_brightness', array['timestamptz'], 'tick_brightness(timestamptz) exists');
select function_returns('public', 'tick_brightness', array['timestamptz'], 'void', 'tick_brightness returns void');
select ok(not has_function_privilege('anon', 'public.tick_brightness(timestamptz)', 'execute'), 'anon cannot execute tick_brightness');
select ok(not has_function_privilege('authenticated', 'public.tick_brightness(timestamptz)', 'execute'), 'authenticated cannot execute tick_brightness');
select ok(not has_function_privilege('public', 'public.tick_brightness(timestamptz)', 'execute'), 'public cannot execute tick_brightness');

select public.tick_brightness('2026-11-02 12:00+00');

-- star decay
select ok(abs((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b1') - 0.03125) < 1e-6, 'dock visit 15 days old is about 0.03125');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b1'), 'active'::public.song_status, '15-day-old dock visit keeps the song active');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b2'), 'inactive'::public.song_status, '16-day-old dock visit makes the song inactive');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b3'), 'active'::public.song_status, '11-day-old hop visit keeps the song active');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b4'), 'inactive'::public.song_status, '12-day-old hop visit makes the song inactive');
select ok(abs((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b5') - 0.5) < 1e-6, 'dock visit 72 hours old is 0.5');
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b6'), 1::real, 'three fresh dock visits are capped at 1');
select ok(abs((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000bd') - 0.45) < 1e-6, 'like 0.6 + start 0.3 at 72 hours old is 0.45');

-- overrides
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b7'), 1::real, 'no visits, real person docked: brightness 1');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b7'), 'active'::public.song_status, 'no visits, real person docked: active');
select ok(abs((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b8') - 0.15) < 1e-6, 'no visits, sample dock only: 0.15');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b8'), 'active'::public.song_status, 'no visits, sample dock only: active');
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b9'), 0::real, 'no visits, no dock: brightness 0');
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b9'), 'inactive'::public.song_status, 'no visits, no dock: inactive');
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000bb'), 1::real, 'a sample dock does not lower a brighter computed value');
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000bc'), 1::real, 'a real dock beats a song with only stale visits');

-- visit cleanup
select is((select count(*) from public.visits where song_id in ('00000000-0000-0000-0000-0000000000ba', '00000000-0000-0000-0000-0000000000bc')), 0::bigint, 'visits older than 30 days are deleted');
select is((select count(*) from public.visits where song_id = '00000000-0000-0000-0000-0000000000b1'), 1::bigint, 'visits inside 30 days are kept');

-- traces
select ok(abs((select brightness from public.traces where id = '00000000-0000-0000-0000-0000000000e1') - 0.5) < 1e-6, 'trace 7 days old is 0.5');
select ok((select brightness from public.traces where id = '00000000-0000-0000-0000-0000000000e2') >= 0.1, 'trace 23 days old is still at least 0.1');

select ok((select brightness from public.traces where id = '00000000-0000-0000-0000-0000000000e3') < 0.1, 'trace 24 days old is below 0.1');

-- schedule
select is((select schedule from cron.job where jobname = 'brightness-tick'), '0 * * * *', 'brightness-tick is scheduled hourly');
select is((select command from cron.job where jobname = 'brightness-tick'), 'select public.tick_brightness()', 'brightness-tick runs tick_brightness');

select * from finish();
rollback;
