-- Invites: one atomic claim-and-create-profile step, callable only by the redeem-invite Edge Function.

create function public.redeem_invite(p_user_id uuid, p_code_hash text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_invite uuid;
begin
  -- One statement claims the invite, so two concurrent redeemers cannot both win.
  update public.invites
  set redeemed_by = p_user_id, redeemed_at = now()
  where code_hash = p_code_hash and redeemed_at is null and expires_at > now()
  returning id into v_invite;

  if v_invite is null then
    return false;
  end if;

  -- A second profile for the same user (or an unknown user) raises, which rolls the claim back too.
  insert into public.profiles (user_id, colour_seed, ship_colour)
  values (p_user_id, encode(extensions.gen_random_bytes(8), 'hex'), '#e8554e');

  return true;
end;
$$;

revoke all on function public.redeem_invite(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_invite(uuid, text) to service_role;
