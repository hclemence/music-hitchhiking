-- Access rules: nothing is readable except through member-only views and four owner-only tables.
-- Writes happen later through security-definer RPCs.

-- 1. Nothing is exposed by default, now or for future objects.
alter table public.regions enable row level security;
alter table public.songs enable row level security;
alter table public.song_neighbours enable row level security;
alter table public.visits enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.docks enable row level security;
alter table public.journeys enable row level security;
alter table public.hops enable row level security;
alter table public.likes enable row level security;
alter table public.traces enable row level security;
alter table public.suggestions enable row level security;
alter table public.kept_notices enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PUBLIC's implicit execute right on new functions can only be removed by a global default.
-- Later RPCs grant execute to authenticated explicitly.
alter default privileges revoke execute on functions from public;

-- 2. Membership helpers.
create function public.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where user_id = auth.uid());
$$;

create function public.require_member() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  return auth.uid();
end;
$$;

revoke all on function public.is_member() from public;
revoke all on function public.require_member() from public;
grant execute on function public.is_member() to authenticated;
grant execute on function public.require_member() to authenticated;

-- 3. Owner-only row access. Policies are for authenticated; anon has no grants at all.
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = auth.uid());

create policy journeys_select_own on public.journeys
  for select to authenticated using (user_id = auth.uid());

create policy hops_select_own on public.hops
  for select to authenticated
  using (exists (select 1 from public.journeys j where j.id = hops.journey_id and j.user_id = auth.uid()));

create policy likes_select_own on public.likes
  for select to authenticated using (user_id = auth.uid());

grant select on public.profiles, public.journeys, public.hops, public.likes to authenticated;

-- 4. Member-only views. Owned by postgres (not security_invoker) so they can read the locked tables;
--    every view filters on is_member() and exposes no user_id.
create view public.active_stars as
  select s.id, s.title, s.artist, s.x, s.y, s.z, s.region_id, s.local_radius, s.brightness,
         s.spotify_url, s.apple_url, s.youtube_url
  from public.songs s
  where s.status = 'active' and public.is_member();

create view public.public_docks as
  select d.id, d.song_id, d.is_sample, d.ship_colour, d.updated_at
  from public.docks d
  join public.songs s on s.id = d.song_id
  where s.status = 'active' and public.is_member();

create view public.map_regions as
  select r.id, r.x, r.y, r.z, r.adjacent
  from public.regions r
  where public.is_member();

revoke all on public.active_stars, public.public_docks, public.map_regions from public, anon, authenticated;
grant select on public.active_stars, public.public_docks, public.map_regions to authenticated;
