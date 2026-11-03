-- Song search for choosing a dock: members only, any status, case-insensitive match on title or artist.
create function public.search_songs(p_query text)
returns table (id uuid, title text, artist text, x real, y real, z real, region_id int,
               local_radius real, brightness real, spotify_url text, apple_url text, youtube_url text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text;
  v_pattern text;
begin
  perform public.require_member();
  v_q := btrim(coalesce(p_query, ''));
  if char_length(v_q) < 2 or char_length(v_q) > 100 then
    raise exception 'bad_query' using errcode = 'P0001';
  end if;
  -- escape the LIKE metacharacters so the query is matched literally
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select s.id, s.title, s.artist, s.x, s.y, s.z, s.region_id, s.local_radius, s.brightness,
           s.spotify_url, s.apple_url, s.youtube_url
    from public.songs s
    where s.title ilike v_pattern escape '\' or s.artist ilike v_pattern escape '\'
    order by s.brightness desc, s.title
    limit 20;
end;
$$;

revoke all on function public.search_songs(text) from public, anon;
grant execute on function public.search_songs(text) to authenticated;


-- tick_brightness is also called through PostgREST (pnpm seed:sample), where pg-safeupdate rejects an
-- UPDATE without a WHERE clause. Same body as before, plus `where true` on the trace update.
create or replace function public.tick_brightness(p_now timestamptz default now())
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Visits older than 30 days no longer count and are removed.
  delete from public.visits where created_at < p_now - interval '30 days';

  -- Star brightness: sum of weight * 0.5^(age_hours / 72) over the last 30 days, capped at 1.
  -- A real person docked = 1; a sample-only dock = at least 0.15. Applies to every song.
  with computed as (
    select s.id,
           coalesce((
             select sum(
               case v.kind
                 when 'dock' then 1.0
                 when 'like' then 0.6
                 when 'suggestion' then 0.5
                 when 'hop' then 0.4
                 when 'start' then 0.3
               end * power(0.5, greatest(extract(epoch from (p_now - v.created_at)), 0) / 3600 / 72)
             )
             from public.visits v
             where v.song_id = s.id and v.created_at > p_now - interval '30 days'
           ), 0) as raw,
           exists (select 1 from public.docks d where d.song_id = s.id and d.user_id is not null) as real_dock,
           exists (select 1 from public.docks d where d.song_id = s.id and d.user_id is null) as sample_dock
    from public.songs s
  ),
  final as (
    select id,
           case
             when real_dock then 1.0
             when sample_dock then greatest(least(1.0, raw), 0.15)
             else least(1.0, raw)
           end as b
    from computed
  )
  update public.songs s
  set brightness = f.b,
      status = case when f.b >= 0.03 then 'active'::public.song_status else 'inactive'::public.song_status end
  from final f
  where f.id = s.id;

  -- Trace brightness: halves every 7 days since the last exchange.
  update public.traces
  set brightness = power(0.5, greatest(extract(epoch from (p_now - last_exchange_at)), 0) / 86400 / 7)
  where true;
end $$;
