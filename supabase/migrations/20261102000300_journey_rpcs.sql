-- Dock, ship and journey RPCs. Clients cannot write any table; every write goes through these
-- security-definer functions. Return values never contain another person's user_id.

-- Day boundary is 4:00 local time. Pure helper (no table access), so it needs no membership check.
create function public.journey_day(ts timestamptz, tz text) returns date
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    raise exception 'invalid_time_zone' using errcode = 'P0001';
  end if;
  return ((ts at time zone tz) - interval '4 hours')::date;
end;
$$;

create function public.set_dock(p_song_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_dock uuid;
begin
  v_uid := public.require_member();
  if not exists (select 1 from public.songs s where s.id = p_song_id) then
    raise exception 'unknown_song' using errcode = 'P0001';
  end if;

  insert into public.docks (user_id, song_id, is_sample, ship_colour)
  select v_uid, p_song_id, false, p.ship_colour
  from public.profiles p
  where p.user_id = v_uid
  on conflict (user_id) do update
    set song_id = excluded.song_id,
        ship_colour = excluded.ship_colour,
        updated_at = now()
  returning id into v_dock;

  insert into public.visits (song_id, kind) values (p_song_id, 'dock');
  update public.songs set brightness = 1, status = 'active' where id = p_song_id;
  return v_dock;
end;
$$;

create function public.set_home(p_song_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := public.require_member();
  if not exists (select 1 from public.songs s where s.id = p_song_id) then
    raise exception 'unknown_song' using errcode = 'P0001';
  end if;
  update public.profiles set home_song_id = p_song_id where user_id = v_uid;
end;
$$;

create function public.set_ship_colour(p_colour text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := public.require_member();
  if p_colour is null or p_colour !~ '^#[0-9a-f]{6}$' then
    raise exception 'bad_colour' using errcode = 'P0001';
  end if;
  update public.profiles set ship_colour = p_colour where user_id = v_uid;
  update public.docks set ship_colour = p_colour, updated_at = now() where user_id = v_uid;
end;
$$;

create function public.current_journey(p_tz text)
returns table (journey_id uuid, current_hop_id uuid, start_song_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid;
begin
  v_uid := public.require_member();
  return query
    select j.id, j.current_hop_id, j.start_song_id
    from public.journeys j
    where j.user_id = v_uid and j.day = public.journey_day(now(), p_tz);
end;
$$;

create function public.start_journey(p_tz text, p_song_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_day date;
  v_journey uuid := gen_random_uuid();
  v_hop uuid := gen_random_uuid();
begin
  v_uid := public.require_member();
  v_day := public.journey_day(now(), p_tz);
  if not exists (select 1 from public.songs s where s.id = p_song_id) then
    raise exception 'unknown_song' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.journeys j where j.user_id = v_uid and j.day = v_day) then
    raise exception 'journey_exists' using errcode = 'P0001';
  end if;

  begin
    -- current_hop_id is a deferred FK, so the journey can point at the root hop before it exists.
    insert into public.journeys (id, user_id, day, start_song_id, current_hop_id)
    values (v_journey, v_uid, v_day, p_song_id, v_hop);
  exception when unique_violation then
    raise exception 'journey_exists' using errcode = 'P0001';
  end;
  insert into public.hops (id, journey_id, parent_hop_id, song_id, kind)
  values (v_hop, v_journey, null, p_song_id, 'start');
  insert into public.visits (song_id, kind) values (p_song_id, 'start');
  return v_hop;
end;
$$;

create function public.hop(p_tz text, p_parent_hop_id uuid, p_song_id uuid, p_kind public.hop_kind) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_journey uuid;
  v_status public.song_status;
  v_hop uuid;
begin
  v_uid := public.require_member();
  if p_kind is distinct from 'hitchhike' and p_kind is distinct from 'jump' then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;

  select j.id into v_journey
  from public.journeys j
  where j.user_id = v_uid and j.day = public.journey_day(now(), p_tz);
  if v_journey is null or not exists (
    select 1 from public.hops h where h.id = p_parent_hop_id and h.journey_id = v_journey
  ) then
    raise exception 'bad_hop' using errcode = 'P0001';
  end if;

  select s.status into v_status from public.songs s where s.id = p_song_id;
  if not found then
    raise exception 'unknown_song' using errcode = 'P0001';
  end if;
  if p_kind = 'hitchhike' and v_status <> 'active' then
    raise exception 'inactive_song' using errcode = 'P0001';
  end if;

  insert into public.hops (journey_id, parent_hop_id, song_id, kind)
  values (v_journey, p_parent_hop_id, p_song_id, p_kind)
  returning id into v_hop;
  update public.journeys set current_hop_id = v_hop where id = v_journey;
  if p_kind = 'hitchhike' then
    insert into public.visits (song_id, kind) values (p_song_id, 'hop');
  end if;
  return v_hop;
end;
$$;

create function public.move_to(p_tz text, p_hop_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_journey uuid;
begin
  v_uid := public.require_member();
  select j.id into v_journey
  from public.journeys j
  where j.user_id = v_uid and j.day = public.journey_day(now(), p_tz);
  if v_journey is null or not exists (
    select 1 from public.hops h where h.id = p_hop_id and h.journey_id = v_journey
  ) then
    raise exception 'bad_hop' using errcode = 'P0001';
  end if;
  update public.journeys set current_hop_id = p_hop_id where id = v_journey;
end;
$$;

revoke all on function public.journey_day(timestamptz, text) from public, anon;
revoke all on function public.set_dock(uuid) from public, anon;
revoke all on function public.set_home(uuid) from public, anon;
revoke all on function public.set_ship_colour(text) from public, anon;
revoke all on function public.current_journey(text) from public, anon;
revoke all on function public.start_journey(text, uuid) from public, anon;
revoke all on function public.hop(text, uuid, uuid, public.hop_kind) from public, anon;
revoke all on function public.move_to(text, uuid) from public, anon;
grant execute on function public.journey_day(timestamptz, text) to authenticated;
grant execute on function public.set_dock(uuid) to authenticated;
grant execute on function public.set_home(uuid) to authenticated;
grant execute on function public.set_ship_colour(text) to authenticated;
grant execute on function public.current_journey(text) to authenticated;
grant execute on function public.start_journey(text, uuid) to authenticated;
grant execute on function public.hop(text, uuid, uuid, public.hop_kind) to authenticated;
grant execute on function public.move_to(text, uuid) to authenticated;
