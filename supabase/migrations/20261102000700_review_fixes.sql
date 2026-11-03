-- Final-review fixes: own-dock view, song lookup, curated ship colours, cheaper membership checks, hops index.

-- I2. The caller's own dock (no user_id; filtered to the caller and members).
create view public.my_dock with (security_barrier) as
  select d.id, d.song_id, d.ship_colour, d.updated_at
  from public.docks d
  where d.user_id = auth.uid() and (select public.is_member());

revoke all on public.my_dock from public, anon, authenticated;
grant select on public.my_dock to authenticated;

-- I3. Star fields for specific songs regardless of status (a journey can land on an inactive song).
-- Read-only: records no visit.
create function public.get_songs(p_ids uuid[])
returns table (id uuid, title text, artist text, x real, y real, z real, region_id int,
               local_radius real, brightness real, spotify_url text, apple_url text, youtube_url text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_member();
  if coalesce(cardinality(p_ids), 0) > 200 then
    raise exception 'too_many_ids' using errcode = 'P0001';
  end if;
  return query
    select s.id, s.title, s.artist, s.x, s.y, s.z, s.region_id, s.local_radius, s.brightness,
           s.spotify_url, s.apple_url, s.youtube_url
    from public.songs s
    where s.id = any (p_ids);
end;
$$;

revoke all on function public.get_songs(uuid[]) from public, anon;
grant execute on function public.get_songs(uuid[]) to authenticated;

-- M1. Ship colour must be one of the 12 palette colours (keep in step with SHIP_COLOURS in
-- supabase/functions/_shared/core/palette.ts; a Vitest test compares the two).
create or replace function public.set_ship_colour(p_colour text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := public.require_member();
  if p_colour is null or p_colour <> all (array[
    '#e8554e', '#f08a3c', '#f2c14e', '#9bd45a', '#3fbf7f', '#2fb5b5',
    '#3a9be0', '#5b6cf0', '#9361e8', '#d65ad1', '#f07aa6', '#e9e4d8'
  ]) then
    raise exception 'bad_colour' using errcode = 'P0001';
  end if;
  update public.profiles set ship_colour = p_colour where user_id = v_uid;
  update public.docks set ship_colour = p_colour, updated_at = now() where user_id = v_uid;
end;
$$;

-- M4. Evaluate the membership check once per query instead of once per row.
-- Same columns, owner, options and grants as before.
create or replace view public.active_stars as
  select s.id, s.title, s.artist, s.x, s.y, s.z, s.region_id, s.local_radius, s.brightness,
         s.spotify_url, s.apple_url, s.youtube_url
  from public.songs s
  where s.status = 'active' and (select public.is_member());

create or replace view public.public_docks with (security_barrier) as
  select d.id, d.song_id, d.is_sample, d.ship_colour, d.updated_at
  from public.docks d
  join public.songs s on s.id = d.song_id
  where s.status = 'active' and (select public.is_member());

create or replace view public.map_regions as
  select r.id, r.x, r.y, r.z, r.adjacent
  from public.regions r
  where (select public.is_member());

create or replace view public.my_traces with (security_barrier) as
  select t.id, t.origin_song_id, s.title as origin_title, s.artist as origin_artist,
         p.ship_colour, t.brightness, t.last_exchange_at
  from public.traces t
  join public.songs s on s.id = t.origin_song_id
  left join public.profiles p on p.user_id = t.target_id
  where t.holder_id = auth.uid() and t.brightness >= 0.1 and (select public.is_member());

create or replace view public.my_inbox with (security_barrier) as
  select g.id, 'suggestion'::text as kind, g.song_id, s.title, s.artist,
         p.ship_colour, rt.id as reply_trace_id, g.created_at, g.seen_at
  from public.suggestions g
  join public.songs s on s.id = g.song_id
  left join public.profiles p on p.user_id = g.from_id
  left join public.traces rt on rt.holder_id = g.to_id and rt.target_id = g.from_id and rt.brightness >= 0.1
  where g.to_id = auth.uid() and (select public.is_member())
  union all
  select k.id, 'kept'::text as kind, k.song_id, s.title, s.artist,
         null::text as ship_colour, null::uuid as reply_trace_id, k.created_at, k.seen_at
  from public.kept_notices k
  join public.songs s on s.id = k.song_id
  where k.owner_id = auth.uid() and (select public.is_member());

-- M5. hops are read by journey (RLS policy and hop-tree reads).
create index hops_journey_id_idx on public.hops (journey_id);
