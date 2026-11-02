begin;
create extension if not exists pgtap with schema extensions;

select plan(107);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- fixtures (run as postgres): A, B and C are members; D has an auth user but no profile.
-- s1..s5 are real songs, s9 does not exist. B docks on s1; a sample dock sits on s2.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'd@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'e@example.test');
insert into public.songs (id, mbid, title, artist, x, y, z, local_radius, spotify_url, apple_url, youtube_url, brightness, status, origin) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Song One', 'Artist One', 0, 0, 0, 10, 's1', 'a1', 'y1', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'Song Two', 'Artist Two', 1, 0, 0, 10, 's2', 'a2', 'y2', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', 'Song Three', 'Artist Three', 2, 0, 0, 10, 's3', 'a3', 'y3', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c4', 'Song Four', 'Artist Four', 3, 0, 0, 10, 's4', 'a4', 'y4', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5', 'Song Five', 'Artist Five', 4, 0, 0, 10, 's5', 'a5', 'y5', 0.5, 'active', 'seed'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000c6', 'Song Six', 'Artist Six', 5, 0, 0, 10, 's6', 'a6', 'y6', 0, 'inactive', 'seed');
insert into public.profiles (user_id, colour_seed, ship_colour) values
  ('00000000-0000-0000-0000-0000000000a1', 'seed-a', '#aaaaaa'),
  ('00000000-0000-0000-0000-0000000000a2', 'seed-b', '#bbbbbb'),
  ('00000000-0000-0000-0000-0000000000a3', 'seed-c', '#cccccc'),
  ('00000000-0000-0000-0000-0000000000a5', 'seed-e', '#eeeeee');
insert into public.docks (id, user_id, song_id, is_sample, ship_colour) values
  ('00000000-0000-0000-0000-0000000000d5', null, '00000000-0000-0000-0000-0000000000b2', true, '#dddddd'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b6', false, '#cccccc');

reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b5')$$, 'A docks on s5');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b1')$$, 'B docks on s1');
reset role;
select set_config('test.a_dock', (select id::text from public.docks where user_id = '00000000-0000-0000-0000-0000000000a1'), true);
select set_config('test.b_dock', (select id::text from public.docks where user_id = '00000000-0000-0000-0000-0000000000a2'), true);

-- privileges and shape
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('like_dock','find_trace','send_suggestion','mark_inbox_seen') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))$$, 'trace RPCs are not executable by anon or public');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('like_dock','find_trace','send_suggestion','mark_inbox_seen') and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef), 4::bigint, 'all 4 trace RPCs are security definer and executable by authenticated');
select ok(not has_table_privilege('anon', 'public.my_traces', 'select') and not has_table_privilege('anon', 'public.my_inbox', 'select'), 'anon cannot select the trace views');
select ok(has_table_privilege('authenticated', 'public.my_traces', 'select') and has_table_privilege('authenticated', 'public.my_inbox', 'select'), 'authenticated can select the trace views');
select columns_are('public', 'my_traces', array['id', 'origin_song_id', 'origin_title', 'origin_artist', 'ship_colour', 'brightness', 'last_exchange_at'], 'my_traces columns');
select columns_are('public', 'my_inbox', array['id', 'kind', 'song_id', 'title', 'artist', 'ship_colour', 'reply_trace_id', 'created_at', 'seen_at'], 'my_inbox columns');
select is_empty($$select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('my_traces', 'my_inbox') and column_name in ('target_id', 'holder_id', 'from_id', 'to_id', 'user_id', 'owner_id')$$, 'trace views expose no person ids');
select is((select count(*) from pg_class c where c.oid in ('public.my_traces'::regclass, 'public.my_inbox'::regclass, 'public.public_docks'::regclass) and coalesce(c.reloptions, '{}') @> array['security_barrier=true'] and not (coalesce(c.reloptions, '{}') @> array['security_invoker=true'])), 3::bigint, 'my_traces, my_inbox and public_docks are security barriers, not security invokers');

-- like_dock
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.like_dock('00000000-0000-0000-0000-0000000000f9')$$, 'P0001', 'unknown_dock', 'like_dock rejects a missing dock');
select throws_ok($$select public.like_dock(current_setting('test.a_dock')::uuid)$$, 'P0001', 'own_dock', 'like_dock rejects your own dock');
select ok(public.like_dock(current_setting('test.b_dock')::uuid) is not null, 'like_dock on a real dock returns a trace id');
select is((select count(*) from public.my_traces), 1::bigint, 'A has one trace');
select is((select ship_colour from public.my_traces), '#bbbbbb', 'the trace shows B''s ship colour');
select is((select origin_song_id from public.my_traces), '00000000-0000-0000-0000-0000000000b1'::uuid, 'the trace starts at B''s dock song');
select is((select origin_title from public.my_traces), 'Song One', 'the trace carries the song title');
select is((select origin_artist from public.my_traces), 'Artist One', 'the trace carries the song artist');
select is((select brightness from public.my_traces), 1::real, 'a new trace is at full brightness');
select is((select count(*) from public.likes), 1::bigint, 'A has one like');
reset role;
select set_config('test.trace_ab', (select id::text from public.traces where holder_id = '00000000-0000-0000-0000-0000000000a1' and target_id = '00000000-0000-0000-0000-0000000000a2'), true);
select is((select count(*) from public.visits where kind = 'like'), 1::bigint, 'a like visit is recorded');
select is((select owner_id from public.kept_notices), '00000000-0000-0000-0000-0000000000a2'::uuid, 'the kept notice belongs to the dock owner');
select is((select song_id from public.kept_notices), '00000000-0000-0000-0000-0000000000b1'::uuid, 'the kept notice names the dock song');

reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.my_inbox), 1::bigint, 'B has one inbox row');
select is((select kind from public.my_inbox), 'kept', 'it is a kept notice');
select is((select ship_colour from public.my_inbox), null, 'a kept notice has no ship colour');
select is((select reply_trace_id from public.my_inbox), null, 'a kept notice has no reply trace');
select is((select song_id from public.my_inbox), '00000000-0000-0000-0000-0000000000b1'::uuid, 'the kept notice names the song');
select is((select title from public.my_inbox), 'Song One', 'the kept notice carries the title');
select is((select count(*) from public.my_traces), 0::bigint, 'B has no trace of A yet');

-- liking the same dock again keeps one like and one trace, and refreshes the trace
reset role;
update public.traces set last_exchange_at = now() - interval '3 days', brightness = 0.7 where id = current_setting('test.trace_ab')::uuid;
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.like_dock(current_setting('test.b_dock')::uuid), current_setting('test.trace_ab')::uuid, 'liking again returns the same trace id');
reset role;
select is((select count(*) from public.likes), 1::bigint, 'still one like');
select is((select count(*) from public.traces where holder_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'still one trace');
select is((select last_exchange_at from public.traces where id = current_setting('test.trace_ab')::uuid), now(), 'the trace exchange time is refreshed');
select is((select brightness from public.traces where id = current_setting('test.trace_ab')::uuid), 1::real, 'the trace is back to full brightness');
select is((select origin_song_id from public.traces where id = current_setting('test.trace_ab')::uuid), '00000000-0000-0000-0000-0000000000b1'::uuid, 'the origin song is unchanged on refresh');
select is((select count(*) from public.kept_notices), 1::bigint, 'a repeated like does not add a second kept notice');
select is((select count(*) from public.visits where kind = 'like'), 1::bigint, 'a repeated like does not add a second visit');

-- sample dock
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.like_dock('00000000-0000-0000-0000-0000000000d5'), null, 'liking a sample dock returns null');
reset role;
select is((select count(*) from public.likes where user_id = '00000000-0000-0000-0000-0000000000a1' and song_id = '00000000-0000-0000-0000-0000000000b2'), 1::bigint, 'the sample like is stored');
select is((select count(*) from public.traces), 1::bigint, 'a sample like creates no trace');
select is((select count(*) from public.kept_notices), 1::bigint, 'a sample like creates no kept notice');

-- a like already stored via the sample dock must not swallow the kept notice for a real dock on the same song
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b2')$$, 'E docks on s2');
reset role;
select set_config('test.e_dock', (select id::text from public.docks where user_id = '00000000-0000-0000-0000-0000000000a5'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select ok(public.like_dock(current_setting('test.e_dock')::uuid) is not null, 'A likes E''s dock on a song already liked via the sample');
reset role;
select is((select count(*) from public.likes where user_id = '00000000-0000-0000-0000-0000000000a1' and song_id = '00000000-0000-0000-0000-0000000000b2'), 1::bigint, 'still one like for s2');
select is((select count(*) from public.traces where holder_id = '00000000-0000-0000-0000-0000000000a1' and target_id = '00000000-0000-0000-0000-0000000000a5'), 1::bigint, 'the trace to E exists');
select is((select count(*) from public.kept_notices where owner_id = '00000000-0000-0000-0000-0000000000a5'), 1::bigint, 'E gets exactly one kept notice');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.like_dock(current_setting('test.e_dock')::uuid)$$, 'A likes E''s dock again');
reset role;
select is((select count(*) from public.kept_notices where owner_id = '00000000-0000-0000-0000-0000000000a5'), 1::bigint, 'a repeat like keeps E at one kept notice');
select is((select count(*) from public.visits where kind = 'like' and song_id = '00000000-0000-0000-0000-0000000000b2'), 1::bigint, 'the s2 like visit was recorded once');

-- inactive song
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.like_dock('00000000-0000-0000-0000-0000000000d6')$$, 'P0001', 'inactive_song', 'like_dock on a dock whose song is inactive raises inactive_song');

-- find_trace
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.find_trace(current_setting('test.trace_ab')::uuid), '00000000-0000-0000-0000-0000000000b1'::uuid, 'find_trace returns B''s dock song');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.set_dock('00000000-0000-0000-0000-0000000000b3')$$, 'B moves to s3');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.find_trace(current_setting('test.trace_ab')::uuid), '00000000-0000-0000-0000-0000000000b3'::uuid, 'find_trace follows B to the new dock song');
select throws_ok($$select public.find_trace('00000000-0000-0000-0000-0000000000f9')$$, 'P0001', 'bad_trace', 'find_trace on a missing trace raises bad_trace');
select throws_ok($$select public.like_dock(current_setting('test.b_dock')::uuid)$$, 'P0001', 'unknown_dock', 'B''s old dock id is gone after B moves to another song');
select isnt((select id from public.public_docks where song_id = '00000000-0000-0000-0000-0000000000b3'), current_setting('test.b_dock')::uuid, 'B''s public dock has a new id');
reset role;
select set_config('test.b_dock2', (select id::text from public.docks where user_id = '00000000-0000-0000-0000-0000000000a2'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(public.set_dock('00000000-0000-0000-0000-0000000000b3'), current_setting('test.b_dock2')::uuid, 'set_dock to the same song keeps the dock id');
select is(public.set_dock('00000000-0000-0000-0000-0000000000b3'), (select id from public.public_docks where song_id = '00000000-0000-0000-0000-0000000000b3'), 'set_dock returns the id shown in public_docks');
reset role;
select is((select count(*) from public.docks where user_id = '00000000-0000-0000-0000-0000000000a2'), 1::bigint, 'B still has one dock');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.find_trace(current_setting('test.trace_ab')::uuid)$$, 'P0001', 'bad_trace', 'B cannot find_trace on A''s trace');
select throws_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b4')$$, 'P0001', 'bad_trace', 'B cannot send_suggestion on A''s trace');
select is_empty($$select 1 from public.my_traces where id = current_setting('test.trace_ab')::uuid$$, 'B cannot see A''s trace');
select throws_ok($$select * from public.traces$$, '42501', null, 'B cannot read the traces table');
select throws_ok($$select * from public.suggestions$$, '42501', null, 'B cannot read the suggestions table');

-- send_suggestion
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b9')$$, 'P0001', 'unknown_song', 'send_suggestion rejects a missing song');
select throws_ok($$select public.send_suggestion('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000b4')$$, 'P0001', 'bad_trace', 'send_suggestion rejects a missing trace');
select ok(public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b4') is not null, 'A suggests s4 to B');
reset role;
select is((select count(*) from public.visits where kind = 'suggestion' and song_id = '00000000-0000-0000-0000-0000000000b4'), 1::bigint, 'a suggestion visit is recorded');
select is((select origin_song_id from public.traces where holder_id = '00000000-0000-0000-0000-0000000000a2' and target_id = '00000000-0000-0000-0000-0000000000a1'), '00000000-0000-0000-0000-0000000000b4'::uuid, 'B gets a reverse trace that starts at the suggested song');

reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.my_inbox where kind = 'suggestion'), 1::bigint, 'B has one suggestion');
select is((select ship_colour from public.my_inbox where kind = 'suggestion'), '#aaaaaa', 'the suggestion shows A''s ship colour');
select is((select song_id from public.my_inbox where kind = 'suggestion'), '00000000-0000-0000-0000-0000000000b4'::uuid, 'the suggestion names s4');
select is((select title from public.my_inbox where kind = 'suggestion'), 'Song Four', 'the suggestion carries the title');
select ok((select reply_trace_id from public.my_inbox where kind = 'suggestion') is not null, 'the suggestion has a reply trace');
select is((select seen_at from public.my_inbox where kind = 'suggestion'), null, 'the suggestion is unseen');
select is((select count(*) from public.my_traces), 1::bigint, 'B now has the reverse trace');
select is((select ship_colour from public.my_traces), '#aaaaaa', 'the reverse trace shows A''s ship colour');
select set_config('test.trace_ba', (select reply_trace_id::text from public.my_inbox where kind = 'suggestion'), true);
select is(public.find_trace(current_setting('test.trace_ba')::uuid), '00000000-0000-0000-0000-0000000000b5'::uuid, 'B can find A through the reverse trace');
select ok(public.send_suggestion(current_setting('test.trace_ba')::uuid, '00000000-0000-0000-0000-0000000000b5') is not null, 'B replies with s5');

reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.my_inbox where kind = 'suggestion'), 1::bigint, 'A has one suggestion');
select is((select song_id from public.my_inbox where kind = 'suggestion'), '00000000-0000-0000-0000-0000000000b5'::uuid, 'A got B''s reply');
select is((select ship_colour from public.my_inbox where kind = 'suggestion'), '#bbbbbb', 'A sees B''s ship colour');
select is((select reply_trace_id from public.my_inbox where kind = 'suggestion'), current_setting('test.trace_ab')::uuid, 'A''s reply trace is A''s trace to B');

-- a suggestion refreshes both traces
reset role;
update public.traces set last_exchange_at = now() - interval '5 days', brightness = 0.6
  where id in (current_setting('test.trace_ab')::uuid, current_setting('test.trace_ba')::uuid);
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b2')$$, 'A suggests s2');
reset role;
select is((select count(*) from public.traces where last_exchange_at = now() and brightness = 1 and id in (current_setting('test.trace_ab')::uuid, current_setting('test.trace_ba')::uuid)), 2::bigint, 'both traces are refreshed');

-- three unseen suggestions per trace direction
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b3')$$, 'A''s third unseen suggestion is allowed');
select throws_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b1')$$, 'P0001', 'suggestion_limit', 'A''s fourth unseen suggestion raises suggestion_limit');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.send_suggestion(current_setting('test.trace_ba')::uuid, '00000000-0000-0000-0000-0000000000b1')$$, 'the limit is per direction: B can still reply');
select is((select count(*) from public.my_inbox where kind = 'suggestion' and seen_at is null), 3::bigint, 'B has three unseen suggestions');
select lives_ok($$select public.mark_inbox_seen()$$, 'B marks the inbox seen');
select is((select count(*) from public.my_inbox where seen_at is null), 0::bigint, 'nothing is unseen for B');
select is((select count(*) from public.my_inbox where kind = 'kept' and seen_at is not null), 1::bigint, 'the kept notice is seen too');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.my_inbox where seen_at is null), 2::bigint, 'B marking seen does not touch A''s inbox');
select lives_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b1')$$, 'A can send again once B has seen the suggestions');

-- faded traces: C is a member, A holds a trace to C that has faded
reset role;
insert into public.traces (id, holder_id, target_id, origin_song_id, last_exchange_at, brightness) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', now() - interval '24 days', 0.09),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b1', now() - interval '20 days', 0.1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is_empty($$select 1 from public.my_traces where id = '00000000-0000-0000-0000-0000000000e1'$$, 'a trace below 0.1 is hidden');
select is((select count(*) from public.my_traces where id = '00000000-0000-0000-0000-0000000000e2'), 1::bigint, 'a trace at 0.1 is still shown');
reset role;
insert into public.traces (id, holder_id, target_id, origin_song_id, last_exchange_at, brightness) values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', now() - interval '24 days', 0.09);
insert into public.suggestions (id, trace_id, from_id, to_id, song_id) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.my_inbox where id = '00000000-0000-0000-0000-0000000000e4'), 1::bigint, 'the suggestion from C is in A''s inbox');
select is((select reply_trace_id from public.my_inbox where id = '00000000-0000-0000-0000-0000000000e4'), null, 'a faded trace is never offered as reply_trace_id');
select throws_ok($$select public.find_trace('00000000-0000-0000-0000-0000000000e1')$$, 'P0001', 'trace_faded', 'find_trace on a faded trace raises trace_faded');
select throws_ok($$select public.send_suggestion('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b4')$$, 'P0001', 'trace_faded', 'send_suggestion on a faded trace raises trace_faded');

-- non-member D: RPCs refuse, views are empty even when rows exist
reset role;
insert into public.traces (holder_id, target_id, origin_song_id) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
insert into public.kept_notices (owner_id, song_id) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b1');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.like_dock(current_setting('test.b_dock')::uuid)$$, 'P0001', 'not_member', 'non-member: like_dock');
select throws_ok($$select public.find_trace(current_setting('test.trace_ab')::uuid)$$, 'P0001', 'not_member', 'non-member: find_trace');
select throws_ok($$select public.send_suggestion(current_setting('test.trace_ab')::uuid, '00000000-0000-0000-0000-0000000000b4')$$, 'P0001', 'not_member', 'non-member: send_suggestion');
select throws_ok($$select public.mark_inbox_seen()$$, 'P0001', 'not_member', 'non-member: mark_inbox_seen');
select is_empty($$select 1 from public.my_traces$$, 'non-member: my_traces is empty');
select is_empty($$select 1 from public.my_inbox$$, 'non-member: my_inbox is empty');

select * from finish();
rollback;
