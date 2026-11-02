begin;
create extension if not exists pgtap with schema extensions;

select plan(51);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- fixtures (run as postgres): A and B are members, C has an auth user but no profile
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');
insert into public.regions (id, x, y, z, adjacent) values (1, 0, 0, 0, '{2}'), (2, 10, 0, 0, '{1}');
insert into public.songs (id, mbid, title, artist, x, y, z, region_id, local_radius, spotify_url, apple_url, youtube_url, status, origin) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Active One', 'Artist', 0, 0, 0, 1, 10, 's1', 'a1', 'y1', 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'Active Two', 'Artist', 1, 0, 0, 1, 10, 's2', 'a2', 'y2', 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', 'Inactive', 'Artist', 2, 0, 0, 2, 10, 's3', 'a3', 'y3', 'inactive', 'seed');
insert into public.song_neighbours (song_id, neighbour_id, weight) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 0.5);
insert into public.visits (song_id, kind) values ('00000000-0000-0000-0000-0000000000b1', 'dock');
insert into public.profiles (user_id, colour_seed, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', 'seed-a', '#aaaaaa'),
  ('00000000-0000-0000-0000-0000000000a2', 'seed-b', '#bbbbbb');
insert into public.invites (expires_at) values (now() + interval '1 day');
insert into public.docks (user_id, song_id, is_sample, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', false, '#aaaaaa'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b3', false, '#bbbbbb'),
  (null, '00000000-0000-0000-0000-0000000000b2', true, '#cccccc');
insert into public.journeys (id, user_id, day, start_song_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '2026-11-02', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', '2026-11-02', '00000000-0000-0000-0000-0000000000b2');
insert into public.hops (id, journey_id, song_id, kind) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'start'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', 'start');
insert into public.likes (user_id, song_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2');
insert into public.traces (holder_id, target_id, origin_song_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1');
insert into public.suggestions (trace_id, from_id, to_id, song_id)
  select id, holder_id, target_id, origin_song_id from public.traces;
insert into public.kept_notices (owner_id, song_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');

-- structure: RLS everywhere, nothing exposed by default
select is_empty($$select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity$$, 'row level security is enabled on every public table');
select is_empty($$select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('regions','songs','song_neighbours','visits','invites','docks','traces','suggestions','kept_notices')$$, 'no table privileges for client roles on internal tables');
select is_empty($$select privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('profiles','journeys','hops','likes') and privilege_type <> 'SELECT'$$, 'owner-readable tables grant select only');
select is_empty($$select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'$$, 'anon has no table or view privileges');
select columns_are('public', 'active_stars', array['id','title','artist','x','y','z','region_id','local_radius','brightness','spotify_url','apple_url','youtube_url'], 'active_stars columns');
select columns_are('public', 'public_docks', array['id','song_id','is_sample','ship_colour','updated_at'], 'public_docks columns');
select columns_are('public', 'map_regions', array['id','x','y','z','adjacent'], 'map_regions columns');
select hasnt_column('public', 'public_docks', 'user_id', 'public_docks has no user_id');
select hasnt_column('public', 'active_stars', 'user_id', 'active_stars has no user_id');
select hasnt_column('public', 'map_regions', 'user_id', 'map_regions has no user_id');

-- future objects are not exposed by default
create table public.zz_probe (id int);
create function public.zz_probe_fn() returns int language sql as 'select 1';
select is(has_table_privilege('authenticated', 'public.zz_probe', 'select'), false, 'new tables are not readable by authenticated');
select is(has_table_privilege('anon', 'public.zz_probe', 'select'), false, 'new tables are not readable by anon');
select is(has_function_privilege('authenticated', 'public.zz_probe_fn()', 'execute'), false, 'new functions are not executable by authenticated');
select is(has_function_privilege('anon', 'public.zz_probe_fn()', 'execute'), false, 'new functions are not executable by anon');

-- as member A
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.is_member(), true, 'A is a member');
select is(public.require_member(), '00000000-0000-0000-0000-0000000000a1'::uuid, 'require_member returns the caller id');
select is((select count(*) from public.active_stars), 2::bigint, 'active_stars shows the two active songs');
select is((select count(*) from public.active_stars where title = 'Inactive'), 0::bigint, 'active_stars hides inactive songs');
select is((select count(*) from public.public_docks), 2::bigint, 'public_docks shows docks on active songs only (own and sample)');
select is((select count(*) from public.public_docks where is_sample), 1::bigint, 'public_docks includes the sample dock');
select is((select count(*) from public.map_regions), 2::bigint, 'map_regions visible to members');
select is((select count(*) from public.profiles), 1::bigint, 'profiles: only own row');
select is((select user_id from public.profiles), '00000000-0000-0000-0000-0000000000a1'::uuid, 'profiles: the row is A''s');
select is((select count(*) from public.journeys), 1::bigint, 'journeys: only own row');
select is((select count(*) from public.hops), 1::bigint, 'hops: only hops of own journeys');
select is((select count(*) from public.likes), 1::bigint, 'likes: only own row');
select throws_ok($$select * from public.visits$$, '42501', null, 'visits not readable');
select throws_ok($$select * from public.invites$$, '42501', null, 'invites not readable');
select throws_ok($$select * from public.traces$$, '42501', null, 'traces not readable');
select throws_ok($$select * from public.suggestions$$, '42501', null, 'suggestions not readable');
select throws_ok($$select * from public.kept_notices$$, '42501', null, 'kept_notices not readable');
select throws_ok($$select * from public.song_neighbours$$, '42501', null, 'song_neighbours not readable');
select throws_ok($$select * from public.songs$$, '42501', null, 'songs not readable');
select throws_ok($$select * from public.docks$$, '42501', null, 'docks not readable (user_id would leak)');
select throws_ok($$select * from public.regions$$, '42501', null, 'regions not readable directly');
select throws_ok($$insert into public.profiles (user_id, colour_seed) values ('00000000-0000-0000-0000-0000000000a1', 'x')$$, '42501', null, 'profiles not writable');
select throws_ok($$insert into public.likes (user_id, song_id) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2')$$, '42501', null, 'likes not writable');
select throws_ok($$update public.journeys set day = '2026-11-03'$$, '42501', null, 'journeys not writable');

-- as member B: sees only their own rows
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select user_id from public.profiles), '00000000-0000-0000-0000-0000000000a2'::uuid, 'B sees only B in profiles');
select is((select count(*) from public.hops), 1::bigint, 'B sees only own hops');

-- as non-member C
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.is_member(), false, 'C is not a member');
select is((select count(*) from public.active_stars), 0::bigint, 'non-member sees no stars');
select is((select count(*) from public.public_docks), 0::bigint, 'non-member sees no docks');
select is((select count(*) from public.map_regions), 0::bigint, 'non-member sees no regions');
select throws_ok($$select public.require_member()$$, 'P0001', 'not_member', 'require_member raises not_member for non-members');
select is((select count(*) from public.profiles), 0::bigint, 'non-member sees no profiles');

-- as anon
reset role;
set local role anon;
select throws_ok($$select * from public.active_stars$$, '42501', null, 'anon cannot read active_stars');
select throws_ok($$select * from public.public_docks$$, '42501', null, 'anon cannot read public_docks');
select throws_ok($$select * from public.map_regions$$, '42501', null, 'anon cannot read map_regions');
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select public.is_member()$$, '42501', null, 'anon cannot execute is_member');

select * from finish();
rollback;
