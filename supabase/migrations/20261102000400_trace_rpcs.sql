-- Likes, traces, suggestions and inbox. A like leaves a private, fading trace so you can find the
-- person again and swap songs. People are known only by ship colour: nothing here returns a user_id.

-- The inbox and trace queries filter on these columns.
create index traces_target_id_idx on public.traces (target_id);
create index suggestions_trace_id_idx on public.suggestions (trace_id);
create index suggestions_to_id_idx on public.suggestions (to_id);
create index kept_notices_owner_id_idx on public.kept_notices (owner_id);

-- Views filter on auth.uid() inside the view, so qualifiers must not be pushed below it.
alter view public.public_docks set (security_barrier = true);

-- A dock that moves to a different song gets a new id, so a member cannot follow a person across
-- docks by remembering an id, or revive a faded trace through it. Same song keeps the id.
create or replace function public.set_dock(p_song_id uuid) returns uuid
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
    set id = case when public.docks.song_id is distinct from excluded.song_id
                  then gen_random_uuid() else public.docks.id end,
        song_id = excluded.song_id,
        ship_colour = excluded.ship_colour,
        updated_at = now()
  returning id into v_dock;

  insert into public.visits (song_id, kind) values (p_song_id, 'dock');
  update public.songs set brightness = 1, status = 'active' where id = p_song_id;
  return v_dock;
end;
$$;

create function public.like_dock(p_dock_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_dock public.docks;
  v_new_like boolean;
  v_new_trace boolean;
  v_trace uuid;
begin
  v_uid := public.require_member();
  select d.* into v_dock from public.docks d where d.id = p_dock_id;
  if not found then
    raise exception 'unknown_dock' using errcode = 'P0001';
  end if;
  if v_dock.user_id = v_uid then
    raise exception 'own_dock' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.songs s where s.id = v_dock.song_id and s.status = 'active') then
    raise exception 'inactive_song' using errcode = 'P0001';
  end if;

  -- A repeated like only refreshes the trace: no second visit, no second notice.
  insert into public.likes (user_id, song_id) values (v_uid, v_dock.song_id)
  on conflict (user_id, song_id) do nothing;
  v_new_like := found;
  if v_new_like then
    insert into public.visits (song_id, kind) values (v_dock.song_id, 'like');
  end if;

  -- Sample ships have no owner, so they leave no trace.
  if v_dock.is_sample then
    return null;
  end if;

  insert into public.traces (holder_id, target_id, origin_song_id)
  values (v_uid, v_dock.user_id, v_dock.song_id)
  on conflict (holder_id, target_id) do update
    set last_exchange_at = now(), brightness = 1
  returning id, (xmax = 0) into v_trace, v_new_trace;

  -- The owner is told once per new like, or when a first trace appears for a song already liked
  -- elsewhere (likes are unique per song, not per dock). A plain repeat like adds nothing.
  if v_new_like or v_new_trace then
    insert into public.kept_notices (owner_id, song_id) values (v_dock.user_id, v_dock.song_id);
  end if;
  return v_trace;
end;
$$;

create function public.find_trace(p_trace_id uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_trace public.traces;
begin
  v_uid := public.require_member();
  select t.* into v_trace from public.traces t where t.id = p_trace_id and t.holder_id = v_uid;
  if not found then
    raise exception 'bad_trace' using errcode = 'P0001';
  end if;
  if v_trace.brightness < 0.1 then
    raise exception 'trace_faded' using errcode = 'P0001';
  end if;
  return (select d.song_id from public.docks d where d.user_id = v_trace.target_id);
end;
$$;

create function public.send_suggestion(p_trace_id uuid, p_song_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_trace public.traces;
  v_suggestion uuid;
begin
  v_uid := public.require_member();
  -- The row lock serialises concurrent sends on one trace, so the unseen limit cannot be overrun.
  select t.* into v_trace from public.traces t where t.id = p_trace_id and t.holder_id = v_uid for update;
  if not found then
    raise exception 'bad_trace' using errcode = 'P0001';
  end if;
  if v_trace.brightness < 0.1 then
    raise exception 'trace_faded' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.songs s where s.id = p_song_id) then
    raise exception 'unknown_song' using errcode = 'P0001';
  end if;
  if (select count(*) from public.suggestions g where g.trace_id = p_trace_id and g.seen_at is null) >= 3 then
    raise exception 'suggestion_limit' using errcode = 'P0001';
  end if;

  insert into public.suggestions (trace_id, from_id, to_id, song_id)
  values (p_trace_id, v_uid, v_trace.target_id, p_song_id)
  returning id into v_suggestion;

  update public.traces set last_exchange_at = now(), brightness = 1 where id = p_trace_id;

  -- The recipient gets (or refreshes) a trace back, so they can find the sender and reply.
  insert into public.traces (holder_id, target_id, origin_song_id)
  values (v_trace.target_id, v_uid, p_song_id)
  on conflict (holder_id, target_id) do update
    set last_exchange_at = now(), brightness = 1;

  insert into public.visits (song_id, kind) values (p_song_id, 'suggestion');
  return v_suggestion;
end;
$$;

create function public.mark_inbox_seen() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := public.require_member();
  update public.suggestions set seen_at = now() where to_id = v_uid and seen_at is null;
  update public.kept_notices set seen_at = now() where owner_id = v_uid and seen_at is null;
end;
$$;

revoke all on function public.like_dock(uuid) from public, anon;
revoke all on function public.find_trace(uuid) from public, anon;
revoke all on function public.send_suggestion(uuid, uuid) from public, anon;
revoke all on function public.mark_inbox_seen() from public, anon;
grant execute on function public.like_dock(uuid) to authenticated;
grant execute on function public.find_trace(uuid) to authenticated;
grant execute on function public.send_suggestion(uuid, uuid) to authenticated;
grant execute on function public.mark_inbox_seen() to authenticated;

-- Member-only views owned by postgres (not security_invoker), filtered to the caller. No person ids.
create view public.my_traces with (security_barrier) as
  select t.id, t.origin_song_id, s.title as origin_title, s.artist as origin_artist,
         p.ship_colour, t.brightness, t.last_exchange_at
  from public.traces t
  join public.songs s on s.id = t.origin_song_id
  left join public.profiles p on p.user_id = t.target_id
  where t.holder_id = auth.uid() and t.brightness >= 0.1 and public.is_member();

create view public.my_inbox with (security_barrier) as
  select g.id, 'suggestion'::text as kind, g.song_id, s.title, s.artist,
         p.ship_colour, rt.id as reply_trace_id, g.created_at, g.seen_at
  from public.suggestions g
  join public.songs s on s.id = g.song_id
  left join public.profiles p on p.user_id = g.from_id
  left join public.traces rt on rt.holder_id = g.to_id and rt.target_id = g.from_id and rt.brightness >= 0.1
  where g.to_id = auth.uid() and public.is_member()
  union all
  select k.id, 'kept'::text as kind, k.song_id, s.title, s.artist,
         null::text as ship_colour, null::uuid as reply_trace_id, k.created_at, k.seen_at
  from public.kept_notices k
  join public.songs s on s.id = k.song_id
  where k.owner_id = auth.uid() and public.is_member();

revoke all on public.my_traces, public.my_inbox from public, anon, authenticated;
grant select on public.my_traces, public.my_inbox to authenticated;
