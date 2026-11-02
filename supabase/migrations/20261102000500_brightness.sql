-- Hourly brightness: stars glow with recent visits and fade; traces fade with time since last exchange.

create extension if not exists pg_cron;

create function public.tick_brightness(p_now timestamptz default now())
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
               end * power(0.5, extract(epoch from (p_now - v.created_at)) / 3600 / 72)
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
  set brightness = power(0.5, extract(epoch from (p_now - last_exchange_at)) / 86400 / 7);
end $$;

revoke all on function public.tick_brightness(timestamptz) from public, anon, authenticated;

-- Idempotent schedule.
select cron.unschedule(jobid) from cron.job where jobname = 'brightness-tick';
select cron.schedule('brightness-tick', '0 * * * *', 'select public.tick_brightness()');
