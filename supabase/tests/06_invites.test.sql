begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');

insert into public.invites (id, code_hash, expires_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'h-valid', now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e2', 'h-expired', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e3', 'h-second', now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e4', 'h-third', now() + interval '1 day');

-- privileges: service role only
select ok(has_function_privilege('service_role', 'public.redeem_invite(uuid,text)', 'execute'), 'service_role can execute redeem_invite');
select ok(not has_function_privilege('authenticated', 'public.redeem_invite(uuid,text)', 'execute'), 'authenticated cannot execute redeem_invite');
select ok(not has_function_privilege('anon', 'public.redeem_invite(uuid,text)', 'execute'), 'anon cannot execute redeem_invite');

-- valid code: claims the invite and creates the profile
select is(public.redeem_invite('00000000-0000-0000-0000-0000000000a1', 'h-valid'), true, 'valid code redeems');
select is((select redeemed_by from public.invites where id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000a1'::uuid, 'invite records who redeemed it');
select isnt((select redeemed_at from public.invites where id = '00000000-0000-0000-0000-0000000000e1'), null, 'invite records when');
select is((select ship_colour from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1'), '#e8554e', 'profile has the default ship colour');
select matches((select colour_seed from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1'), '^[0-9a-f]{16}$', 'profile has a random hex colour seed');

-- not redeemable twice, not when expired, not when unknown
select is(public.redeem_invite('00000000-0000-0000-0000-0000000000a2', 'h-valid'), false, 'redeemed code is refused');
select is(public.redeem_invite('00000000-0000-0000-0000-0000000000a2', 'h-expired'), false, 'expired code is refused');
select is(public.redeem_invite('00000000-0000-0000-0000-0000000000a2', 'h-unknown'), false, 'unknown code is refused');
select is((select count(*)::int from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'refused redemptions create no profile');

-- a user who already has a profile cannot take a second invite, and the invite stays unclaimed
select throws_ok(
  $$select public.redeem_invite('00000000-0000-0000-0000-0000000000a1', 'h-second')$$,
  '23505', null, 'second redemption by a member raises');
select is((select redeemed_at from public.invites where id = '00000000-0000-0000-0000-0000000000e3'), null, 'the raise rolls the claim back');

-- unknown user: the profile foreign key raises and the claim is rolled back
select throws_ok(
  $$select public.redeem_invite('00000000-0000-0000-0000-0000000000ff', 'h-third')$$,
  '23503', null, 'unknown user raises');
select is((select redeemed_at from public.invites where id = '00000000-0000-0000-0000-0000000000e4'), null, 'unknown-user attempt leaves the invite unclaimed');

select * from finish();
rollback;
