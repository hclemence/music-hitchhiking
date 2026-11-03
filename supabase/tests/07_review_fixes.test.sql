begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- fixtures (as postgres): A and B are members, C has an auth user but no profile.
-- b1 active, b2 inactive.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');
insert into public.songs (id, mbid, title, artist, x, y, z, region_id, local_radius, spotify_url, apple_url, youtube_url, brightness, status, origin) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Active One', 'Artist', 1, 2, 3, null, 10, 's1', 'a1', 'y1', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'Inactive Two', 'Artist', 4, 5, 6, null, 7, 's2', 'a2', 'y2', 0, 'inactive', 'seed');
insert into public.profiles (user_id, colour_seed, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', 'seed-a', '#e8554e'),
  ('00000000-0000-0000-0000-0000000000a2', 'seed-b', '#e8554e');
insert into public.docks (id, user_id, song_id, is_sample, ship_colour) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', false, '#e8554e'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', false, '#f08a3c'),
  ('00000000-0000-0000-0000-0000000000d3', null, '00000000-0000-0000-0000-0000000000b1', true, '#9bd45a');

-- structure
select has_view('public', 'my_dock', 'my_dock exists');
select columns_are('public', 'my_dock', array['id', 'song_id', 'ship_colour', 'updated_at'], 'my_dock columns');
select hasnt_column('public', 'my_dock', 'user_id', 'my_dock has no user_id');
select view_owner_is('public', 'my_dock', 'postgres', 'my_dock is owned by postgres');
select ok((select 'security_barrier=true' = any (reloptions) from pg_class where oid = 'public.my_dock'::regclass), 'my_dock is a security barrier');
select ok(has_table_privilege('authenticated', 'public.my_dock', 'select'), 'authenticated can select my_dock');
select ok(not has_table_privilege('anon', 'public.my_dock', 'select'), 'anon cannot select my_dock');
select ok(not has_table_privilege('authenticated', 'public.my_dock', 'insert,update,delete'), 'authenticated cannot write my_dock');

select ok(has_function_privilege('authenticated', 'public.get_songs(uuid[])', 'execute'), 'authenticated can execute get_songs');
select ok(not has_function_privilege('anon', 'public.get_songs(uuid[])', 'execute'), 'anon cannot execute get_songs');
select ok(not has_function_privilege('public', 'public.get_songs(uuid[])', 'execute'), 'public cannot execute get_songs');
select ok((select prosecdef from pg_proc where oid = 'public.get_songs(uuid[])'::regprocedure), 'get_songs is security definer');
select has_index('public', 'hops', 'hops_journey_id_idx', array['journey_id'], 'hops(journey_id) is indexed');

-- recreated views keep owner, options and grants, and test membership once per query
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('active_stars','public_docks','map_regions','my_traces','my_inbox') and pg_get_userbyid(c.relowner) <> 'postgres'$$, 'recreated views are still owned by postgres');
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('public_docks','my_traces','my_inbox') and not coalesce('security_barrier=true' = any (c.reloptions), false)$$, 'views that were security barriers still are');
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('active_stars','public_docks','map_regions','my_traces','my_inbox','my_dock') and pg_get_viewdef(c.oid) !~* '\(\s*select\s+(public\.)?is_member\(\)'$$, 'every member view evaluates is_member() in a sub-select');
select is_empty($$select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'$$, 'anon still has no table or view privileges');
select columns_are('public', 'active_stars', array['id','title','artist','x','y','z','region_id','local_radius','brightness','spotify_url','apple_url','youtube_url'], 'active_stars columns unchanged');
select columns_are('public', 'my_inbox', array['id','kind','song_id','title','artist','ship_colour','reply_trace_id','created_at','seen_at'], 'my_inbox columns unchanged');

-- my_dock: only the caller's own dock
reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select id, song_id, ship_colour from public.my_dock$$,
  $$values ('00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, '#e8554e'::text)$$, 'A sees only A''s dock');
reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select results_eq($$select id, song_id from public.my_dock$$,
  $$values ('00000000-0000-0000-0000-0000000000d2'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid)$$, 'B sees B''s dock, even on an inactive song');
reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is_empty($$select * from public.my_dock$$, 'a non-member sees no dock');
select is((select count(*) from public.active_stars), 0::bigint, 'a non-member still sees no stars');
select is((select count(*) from public.map_regions), 0::bigint, 'a non-member still sees no regions');

-- get_songs
reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select results_eq(
  $$select id, title, artist, x, y, z, region_id, local_radius, brightness, spotify_url, apple_url, youtube_url from public.get_songs(array['00000000-0000-0000-0000-0000000000b2']::uuid[])$$,
  $$values ('00000000-0000-0000-0000-0000000000b2'::uuid, 'Inactive Two'::text, 'Artist'::text, 4::real, 5::real, 6::real, null::int, 7::real, 0::real, 's2'::text, 'a2'::text, 'y2'::text)$$,
  'get_songs returns an inactive song');
select is((select count(*) from public.get_songs(array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f9']::uuid[])), 2::bigint, 'get_songs returns active and inactive songs and skips unknown ids');
select is((select count(*) from public.get_songs('{}'::uuid[])), 0::bigint, 'get_songs of an empty list is empty');
select is((select count(*) from public.get_songs(null)), 0::bigint, 'get_songs of null is empty');
select is((select count(*) from public.get_songs((select array_agg(gen_random_uuid()) from generate_series(1, 200)))), 0::bigint, 'get_songs accepts exactly 200 ids');
select throws_ok($$select * from public.get_songs((select array_agg(gen_random_uuid()) from generate_series(1, 201)))$$, 'P0001', 'too_many_ids', 'get_songs refuses more than 200 ids');
reset role;
select is((select count(*) from public.visits), 0::bigint, 'get_songs records no visit');
select is((select status::text from public.songs where id = '00000000-0000-0000-0000-0000000000b2'), 'inactive', 'get_songs does not change the song');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.get_songs(array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'P0001', 'not_member', 'non-member: get_songs');

-- set_ship_colour only accepts the palette
reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_ship_colour('#e9e4d8')$$, 'set_ship_colour accepts a palette colour');
select throws_ok($$select public.set_ship_colour('#aaaaaa')$$, 'P0001', 'bad_colour', 'set_ship_colour rejects a well-formed non-palette colour');
select throws_ok($$select public.set_ship_colour('#E9E4D8')$$, 'P0001', 'bad_colour', 'set_ship_colour rejects uppercase');
select throws_ok($$select public.set_ship_colour(null)$$, 'P0001', 'bad_colour', 'set_ship_colour rejects null');
reset role;
select is((select ship_colour from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1'), '#e9e4d8', 'the profile took the palette colour');
select is((select ship_colour from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), '#e9e4d8', 'the dock took the palette colour');

select * from finish();
rollback;
