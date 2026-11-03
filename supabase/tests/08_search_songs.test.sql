begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');
insert into public.profiles (user_id, colour_seed, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', 'seed-a', '#e8554e');
insert into public.songs (id, mbid, title, artist, x, y, z, local_radius, spotify_url, apple_url, youtube_url, brightness, status, origin) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Purple Rain', 'Prince', 1, 2, 3, 10, 's', 'a', 'y', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'Hidden Gem', 'Obscure Band', 4, 5, 6, 7, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', '100% Pure', 'Percent Act', 4, 5, 6, 7, 's', 'a', 'y', 0, 'inactive', 'seed'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c4', '100 Pure', 'Plain Act', 4, 5, 6, 7, 's', 'a', 'y', 0, 'inactive', 'seed');
insert into public.songs (mbid, title, artist, x, y, z, local_radius, spotify_url, apple_url, youtube_url, status, origin)
  select gen_random_uuid(), 'Bulk Song ' || g, 'Bulk Artist', 0, 0, 0, 1, 's', 'a', 'y', 'inactive', 'seed' from generate_series(1, 30) g;

select ok(has_function_privilege('authenticated', 'public.search_songs(text)', 'execute'), 'authenticated can execute search_songs');
select ok(not has_function_privilege('anon', 'public.search_songs(text)', 'execute'), 'anon cannot execute search_songs');
select ok(not has_function_privilege('public', 'public.search_songs(text)', 'execute'), 'public cannot execute search_songs');
select ok((select prosecdef from pg_proc where oid = 'public.search_songs(text)'::regprocedure), 'search_songs is security definer');

reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select id from public.search_songs('purple r')$$,
  $$values ('00000000-0000-0000-0000-0000000000b1'::uuid)$$, 'finds by partial title, case-insensitive');
select results_eq($$select id from public.search_songs('PRINCE')$$,
  $$values ('00000000-0000-0000-0000-0000000000b1'::uuid)$$, 'finds by artist, case-insensitive');
select results_eq($$select id from public.search_songs('hidden gem')$$,
  $$values ('00000000-0000-0000-0000-0000000000b2'::uuid)$$, 'finds inactive songs');
select results_eq($$select id from public.search_songs('0% p')$$,
  $$values ('00000000-0000-0000-0000-0000000000b3'::uuid)$$, '% in the query is literal');
select is_empty($$select id from public.search_songs('hidden_gem')$$, '_ in the query is literal');
select throws_ok($$select * from public.search_songs('a')$$, 'P0001', 'bad_query', '1-char query is rejected');
select throws_ok($$select * from public.search_songs(' a ')$$, 'P0001', 'bad_query', 'query is trimmed before the length check');
select throws_ok($$select * from public.search_songs(repeat('a', 101))$$, 'P0001', 'bad_query', '101-char query is rejected');
select is((select count(*)::int from public.search_songs('bulk')), 20, 'at most 20 rows');

reset role; select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.search_songs('prince')$$, 'P0001', 'not_member', 'non-member is rejected');

select * from finish();
rollback;
