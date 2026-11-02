-- Music Hitchhiking: core schema (tables only; access rules, RPCs, brightness and invites come later).

create type public.song_status as enum ('active', 'inactive');
create type public.song_origin as enum ('seed', 'ingest');
create type public.visit_kind as enum ('dock', 'like', 'suggestion', 'hop', 'start');
create type public.hop_kind as enum ('start', 'hitchhike', 'jump');

create table public.regions (
  id int primary key,
  x real not null,
  y real not null,
  z real not null,
  adjacent int[] not null default '{}'
);

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  mbid uuid not null unique,
  title text not null,
  artist text not null,
  x real not null,
  y real not null,
  z real not null,
  region_id int references public.regions (id),
  local_radius real check (local_radius > 0),
  spotify_url text not null,
  apple_url text not null,
  youtube_url text not null,
  brightness real not null default 0,
  status public.song_status not null default 'inactive',
  origin public.song_origin not null,
  created_at timestamptz not null default now()
);
create index songs_status_idx on public.songs (status);

create table public.song_neighbours (
  song_id uuid not null references public.songs (id) on delete cascade,
  neighbour_id uuid not null references public.songs (id) on delete cascade,
  weight real not null check (weight >= 0 and weight <= 1),
  primary key (song_id, neighbour_id)
);

-- Anonymous on purpose: no user_id, no record of who took anyone anywhere.
create table public.visits (
  id bigint generated always as identity primary key,
  song_id uuid not null references public.songs (id) on delete cascade,
  kind public.visit_kind not null,
  created_at timestamptz not null default now()
);
create index visits_created_at_idx on public.visits (created_at);
create index visits_song_id_idx on public.visits (song_id);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  home_song_id uuid references public.songs (id),
  colour_seed text not null,
  ship_colour text check (ship_colour ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz
);

-- user_id is null for sample ships (many allowed; unique ignores nulls).
create table public.docks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id),
  is_sample boolean not null default false,
  ship_colour text,
  updated_at timestamptz not null default now(),
  check (is_sample = (user_id is null))
);
create index docks_song_id_idx on public.docks (song_id);

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  start_song_id uuid not null references public.songs (id),
  current_hop_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

-- Hops carry no person: no user_id, no from_user, no dock_id.
create table public.hops (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  parent_hop_id uuid references public.hops (id),
  song_id uuid not null references public.songs (id),
  kind public.hop_kind not null,
  created_at timestamptz not null default now(),
  check ((kind = 'start') = (parent_hop_id is null))
);

-- journeys and hops reference each other, so this FK is added once hops exists.
alter table public.journeys
  add constraint journeys_current_hop_id_fkey
  foreign key (current_hop_id) references public.hops (id)
  deferrable initially deferred;

create table public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id),
  created_at timestamptz not null default now(),
  unique (user_id, song_id)
);

create table public.traces (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  origin_song_id uuid not null references public.songs (id),
  created_at timestamptz not null default now(),
  last_exchange_at timestamptz not null default now(),
  brightness real not null default 1,
  unique (holder_id, target_id),
  check (holder_id <> target_id)
);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references public.traces (id) on delete cascade,
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create table public.kept_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
