begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- fixtures (run as postgres): A and B are members, C has an auth user but no profile.
-- b1, b2 active; b3 inactive (hitchhike target); b4 inactive (dock activation); b9 does not exist.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');
insert into public.songs (id, mbid, title, artist, x, y, z, local_radius, spotify_url, apple_url, youtube_url, brightness, status, origin) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Active One', 'Artist', 0, 0, 0, 10, 's1', 'a1', 'y1', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'Active Two', 'Artist', 1, 0, 0, 10, 's2', 'a2', 'y2', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', 'Inactive Three', 'Artist', 2, 0, 0, 10, 's3', 'a3', 'y3', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c4', 'Inactive Four', 'Artist', 3, 0, 0, 10, 's4', 'a4', 'y4', 0, 'inactive', 'seed');
insert into public.profiles (user_id, colour_seed, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', 'seed-a', '#aaaaaa'),
  ('00000000-0000-0000-0000-0000000000a2', 'seed-b', '#bbbbbb');

-- journey_day (pure helper, no membership needed)
select is(public.journey_day('2026-11-02 03:59+00', 'UTC'), '2026-11-01'::date, 'journey_day: 03:59 belongs to the previous day');
select is(public.journey_day('2026-11-02 04:00+00', 'UTC'), '2026-11-02'::date, 'journey_day: 04:00 starts the day');
select is(public.journey_day('2026-11-02 23:30+00', 'UTC'), '2026-11-02'::date, 'journey_day: 23:30 is the same day');
select is(public.journey_day('2026-07-01 03:30+00', 'Europe/London'), '2026-07-01'::date, 'journey_day: respects the time zone (04:30 BST)');
select throws_ok($$select public.journey_day(now(), 'Mars/Base')$$, 'P0001', 'invalid_time_zone', 'journey_day rejects unknown time zones');
select is((select provolatile from pg_proc where oid = 'public.journey_day(timestamptz, text)'::regprocedure), 's', 'journey_day is stable');

-- privileges: authenticated only
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('journey_day','set_dock','set_home','set_ship_colour','current_journey','start_journey','hop','move_to') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))$$, 'journey RPCs are not executable by anon or public');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('journey_day','set_dock','set_home','set_ship_colour','current_journey','start_journey','hop','move_to') and has_function_privilege('authenticated', p.oid, 'execute')), 8::bigint, 'all 8 journey RPCs are executable by authenticated');
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('journey_day','set_dock','set_home','set_ship_colour','current_journey','start_journey','hop','move_to') and not p.prosecdef$$, 'journey RPCs are security definer');

-- as member A: docks, home, colour
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b9')$$, 'P0001', 'unknown_song', 'set_dock rejects a missing song');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b1')$$, 'set_dock first song');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b2')$$, 'set_dock second song');
reset role;
select is((select count(*) from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'set_dock twice leaves one dock row for A');
select is((select song_id from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), '00000000-0000-0000-0000-0000000000b2'::uuid, 'the dock is on the second song');
select is((select ship_colour from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), '#aaaaaa', 'the dock copies the profile ship colour');
select is((select is_sample from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), false, 'a real dock is not a sample');
select is((select count(*) from public.visits where kind = 'dock'), 2::bigint, 'two dock visits recorded');
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b2'), 1::real, 'docked song has brightness 1');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b4')$$, 'B docks on an inactive song');
reset role;
select is((select status from public.songs where id = '00000000-0000-0000-0000-0000000000b4'), 'active'::public.song_status, 'docking activates an inactive song');
select is((select brightness from public.songs where id = '00000000-0000-0000-0000-0000000000b4'), 1::real, 'docking sets brightness 1 on a formerly inactive song');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_home('00000000-0000-0000-0000-0000000000b2')$$, 'set_home');
select throws_ok($$select public.set_home('00000000-0000-0000-0000-0000000000b9')$$, 'P0001', 'unknown_song', 'set_home rejects a missing song');
select is((select home_song_id from public.profiles), '00000000-0000-0000-0000-0000000000b2'::uuid, 'home song is stored on the profile');
select lives_ok($$select public.set_ship_colour('#3fbf7f')$$, 'set_ship_colour');
select throws_ok($$select public.set_ship_colour('#3FBF7F')$$, 'P0001', 'bad_colour', 'set_ship_colour rejects uppercase');
select throws_ok($$select public.set_ship_colour('green')$$, 'P0001', 'bad_colour', 'set_ship_colour rejects non-hex');
select is((select ship_colour from public.profiles), '#3fbf7f', 'profile colour updated');
reset role;
select is((select ship_colour from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), '#3fbf7f', 'dock colour updated');

-- as member A: journeys
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is_empty($$select * from public.current_journey('UTC')$$, 'no journey yet today');
select throws_ok($$select public.start_journey('Mars/Base', '00000000-0000-0000-0000-0000000000b1')$$, 'P0001', 'invalid_time_zone', 'start_journey rejects unknown time zones');
select throws_ok($$select public.start_journey('UTC', '00000000-0000-0000-0000-0000000000b9')$$, 'P0001', 'unknown_song', 'start_journey rejects a missing song');
select lives_ok($$select public.start_journey('UTC', '00000000-0000-0000-0000-0000000000b1')$$, 'start_journey');
select is((select count(*) from public.hops where kind = 'start' and parent_hop_id is null), 1::bigint, 'one root hop of kind start');
select is((select current_hop_id from public.journeys), (select id from public.hops where kind = 'start'), 'current_hop_id is the root hop');
select is((select day from public.journeys), public.journey_day(now(), 'UTC'), 'journey is dated today');
select is((select start_song_id from public.journeys), '00000000-0000-0000-0000-0000000000b1'::uuid, 'journey start song stored');
select is((select journey_id from public.current_journey('UTC')), (select id from public.journeys), 'current_journey returns the journey id');
select is((select current_hop_id from public.current_journey('UTC')), (select id from public.hops where kind = 'start'), 'current_journey returns the current hop');
select is((select start_song_id from public.current_journey('UTC')), '00000000-0000-0000-0000-0000000000b1'::uuid, 'current_journey returns the start song');
select throws_ok($$select public.start_journey('UTC', '00000000-0000-0000-0000-0000000000b2')$$, 'P0001', 'journey_exists', 'second start_journey today raises journey_exists');
reset role;
select is((select count(*) from public.visits where kind = 'start'), 1::bigint, 'start visit recorded once');

-- hops
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.hop('UTC', (select id from public.hops where kind = 'start'), '00000000-0000-0000-0000-0000000000b2', 'hitchhike')$$, 'hitchhike from root');
select is((select parent_hop_id from public.hops where kind = 'hitchhike'), (select id from public.hops where kind = 'start'), 'hitchhike hop has the root as parent');
select is((select current_hop_id from public.journeys), (select id from public.hops where kind = 'hitchhike'), 'current_hop_id moved to the new hop');
reset role;
select is((select count(*) from public.visits where kind = 'hop'), 1::bigint, 'hitchhike records one hop visit');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.move_to('UTC', (select id from public.hops where kind = 'start'))$$, 'move_to root');
select is((select current_hop_id from public.journeys), (select id from public.hops where kind = 'start'), 'move_to moves current_hop_id');
select is((select count(*) from public.hops), 2::bigint, 'move_to creates no hop');
select lives_ok($$select public.hop('UTC', (select id from public.hops where kind = 'start'), '00000000-0000-0000-0000-0000000000b1', 'hitchhike')$$, 'branch from root after move_to');
select is((select count(*) from public.hops where parent_hop_id = (select id from public.hops where kind = 'start')), 2::bigint, 'root now has two children (a branch)');
select is((select count(*) from public.hops), 3::bigint, 'three hops in total');

select lives_ok($$select public.hop('UTC', (select current_hop_id from public.journeys), '00000000-0000-0000-0000-0000000000b3', 'jump')$$, 'jump to an inactive song is allowed');
select is((select count(*) from public.hops where kind = 'jump'), 1::bigint, 'jump hop created');
select is((select current_hop_id from public.journeys), (select id from public.hops where kind = 'jump'), 'jump updates current_hop_id');
reset role;
select is((select count(*) from public.visits where kind = 'hop'), 2::bigint, 'jump adds no visit');

-- hop validation
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.hop('UTC', (select id from public.hops where kind = 'start'), '00000000-0000-0000-0000-0000000000b2', 'start')$$, 'P0001', 'bad_kind', 'hop rejects kind start');
select throws_ok($$select public.hop('UTC', (select id from public.hops where kind = 'start'), '00000000-0000-0000-0000-0000000000b3', 'hitchhike')$$, 'P0001', 'inactive_song', 'hitchhike to an inactive song raises inactive_song');
select throws_ok($$select public.hop('UTC', (select id from public.hops where kind = 'start'), '00000000-0000-0000-0000-0000000000b9', 'jump')$$, 'P0001', 'unknown_song', 'jump to a missing song raises unknown_song');
select throws_ok($$select public.hop('Mars/Base', (select id from public.hops where kind = 'start'), '00000000-0000-0000-0000-0000000000b2', 'jump')$$, 'P0001', 'invalid_time_zone', 'hop rejects unknown time zones');
select throws_ok($$select public.move_to('Mars/Base', (select id from public.hops where kind = 'start'))$$, 'P0001', 'invalid_time_zone', 'move_to rejects unknown time zones');
select throws_ok($$select public.hop('UTC', '00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000b2', 'jump')$$, 'P0001', 'bad_hop', 'hop with a missing parent raises bad_hop');

-- B cannot touch A's journey
reset role;
select set_config('test.a_root', (select h.id::text from public.hops h join public.journeys j on j.id = h.journey_id where h.kind = 'start' and j.user_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.start_journey('UTC', '00000000-0000-0000-0000-0000000000b2')$$, 'B starts a journey');
select is((select count(*) from public.hops), 1::bigint, 'B sees only own hop');
select ok(current_setting('test.a_root')::uuid is not null, 'A''s root hop id is known');
select throws_ok($$select public.hop('UTC', current_setting('test.a_root')::uuid, '00000000-0000-0000-0000-0000000000b2', 'hitchhike')$$, 'P0001', 'bad_hop', 'B cannot hop from A''s hop');
select throws_ok($$select public.move_to('UTC', current_setting('test.a_root')::uuid)$$, 'P0001', 'bad_hop', 'B cannot move to A''s hop');
reset role;
select is((select count(*) from public.hops h join public.journeys j on j.id = h.journey_id where j.user_id = '00000000-0000-0000-0000-0000000000a1'), 4::bigint, 'A''s journey is untouched by B');

-- yesterday's hops do not count as today's journey
reset role;
insert into public.journeys (id, user_id, day, start_song_id) values
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000a2', public.journey_day(now(), 'UTC') - 1, '00000000-0000-0000-0000-0000000000b1');
insert into public.hops (id, journey_id, song_id, kind) values
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b1', 'start');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.move_to('UTC', '00000000-0000-0000-0000-0000000000e9')$$, 'P0001', 'bad_hop', 'move_to a hop from yesterday raises bad_hop');
select throws_ok($$select public.hop('UTC', '00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000b2', 'jump')$$, 'P0001', 'bad_hop', 'hop from a hop of yesterday raises bad_hop');

-- non-member C
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b1')$$, 'P0001', 'not_member', 'non-member: set_dock');
select throws_ok($$select public.set_home('00000000-0000-0000-0000-0000000000b1')$$, 'P0001', 'not_member', 'non-member: set_home');
select throws_ok($$select public.set_ship_colour('#3fbf7f')$$, 'P0001', 'not_member', 'non-member: set_ship_colour');
select throws_ok($$select * from public.current_journey('UTC')$$, 'P0001', 'not_member', 'non-member: current_journey');
select throws_ok($$select public.start_journey('UTC', '00000000-0000-0000-0000-0000000000b1')$$, 'P0001', 'not_member', 'non-member: start_journey');
select throws_ok($$select public.hop('UTC', '00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000b1', 'jump')$$, 'P0001', 'not_member', 'non-member: hop');
select throws_ok($$select public.move_to('UTC', '00000000-0000-0000-0000-0000000000e9')$$, 'P0001', 'not_member', 'non-member: move_to');

select * from finish();
rollback;
