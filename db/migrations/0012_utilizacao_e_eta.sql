-- 0012 — Contadores de utilização por função controlada; ETA público só com posição recente.
-- Reversão: drop function bump_usage; repor public_trip_dto de 0006.

create or replace function bump_usage(p_org uuid, p_field text, p_n int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_field not in ('positions_ingested','route_requests','public_views') then raise exception 'campo_invalido'; end if;
  execute format('insert into usage_counters (organization_id, period, %1$I) values ($1, date_trunc(''month'', now())::date, $2)
    on conflict (organization_id, period) do update set %1$I = usage_counters.%1$I + excluded.%1$I', p_field) using p_org, p_n;
end $$;

-- Versão revista do DTO público (igual à de 0006, com ETA dependente da frescura da posição).
create or replace function public_trip_dto(p_share uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s tracking_shares; t trips; o organizations; v vehicles; d drivers; p trip_progress; lp vehicle_latest_positions;
        r trip_routes; active boolean; result jsonb; places_json jsonb; done_geo jsonb; left_geo jsonb; frac double precision;
begin
  select * into s from tracking_shares where id = p_share;
  select * into t from trips where id = s.trip_id;
  select * into o from organizations where id = t.organization_id;
  select * into v from vehicles where id = t.vehicle_id;
  select * into d from drivers where id = t.driver_id;
  select * into p from trip_progress where trip_id = t.id;
  select * into r from trip_routes where trip_id = t.id and is_current;
  active := t.status in ('em_viagem','pausada');
  if active and t.vehicle_id is not null then
    select * into lp from vehicle_latest_positions where vehicle_id = t.vehicle_id and trip_id = t.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', pl.name, 'km', round(rp.km_from_origin::numeric, 1), 'state', rp.state,
      'passed_at', rp.passed_at, 'eta', case when active then rp.eta end,
      'eta_confidence', case when active then rp.eta_confidence end) order by rp.seq), '[]'::jsonb)
    into places_json
  from trip_route_places rp join places pl on pl.id = rp.place_id
  where rp.trip_route_id = r.id and pl.importance >= 3;

  if r.id is not null and p.km_done is not null and r.length_m > 0 then
    frac := least(greatest(p.km_done * 1000 / r.length_m, 0), 1);
    done_geo := case when active and frac > 0 then ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_LineSubstring(r.geom::geometry, 0, frac), 0.0005), 5)::jsonb end;
    left_geo := case when frac < 1 then ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_LineSubstring(r.geom::geometry, frac, 1), 0.0005), 5)::jsonb end;
  elsif r.id is not null then
    left_geo := ST_AsGeoJSON(ST_SimplifyPreserveTopology(r.geom::geometry, 0.0005), 5)::jsonb;
  end if;

  result := jsonb_build_object(
    'code', s.short_code,
    'status', t.status,
    'origin', (select name from places where id = t.origin_place_id),
    'destination', (select name from places where id = t.destination_place_id),
    'origin_point', (select jsonb_build_array(round(ST_X(geom::geometry)::numeric, 5), round(ST_Y(geom::geometry)::numeric, 5)) from places where id = t.origin_place_id),
    'destination_point', (select jsonb_build_array(round(ST_X(geom::geometry)::numeric, 5), round(ST_Y(geom::geometry)::numeric, 5)) from places where id = t.destination_place_id),
    'departed_at', t.actual_departure,
    'delivered_at', case when t.status = 'concluida' then t.actual_arrival end,
    'planned_arrival', t.planned_arrival,
    'position', case when active and lp.vehicle_id is not null then jsonb_build_object(
        'lng', round(ST_X(lp.geom::geometry)::numeric, 5), 'lat', round(ST_Y(lp.geom::geometry)::numeric, 5),
        'heading', lp.heading, 'device_time', lp.device_time) end,
    'progress', case when active and p.km_done is not null then jsonb_build_object(
        'pct', round(p.pct::numeric, 0), 'km_done', round(p.km_done::numeric, 0), 'km_left', round(p.km_left::numeric, 0),
        'current_label', p.current_label,
        'eta', case when p.eta_confidence <> 'indisponivel' and lp.device_time > now() - make_interval(secs => coalesce((o.settings->>'freshness_stale_s')::int, 900)) then p.eta_destination end,
        'eta_confidence', case when lp.device_time > now() - make_interval(secs => coalesce((o.settings->>'freshness_stale_s')::int, 900)) then p.eta_confidence else 'indisponivel' end) end,
    'route_done', done_geo,
    'route_left', case when t.status in ('concluida','cancelada') then null else left_geo end,
    'route_validated_for_truck', r.validated_for_truck,
    'places', places_json,
    'company', case when (s.options->>'show_company')::boolean then coalesce(o.public_name, o.name) end,
    'logo_file_id', case when (s.options->>'show_logo')::boolean and o.logo_file_id is not null then s.id end,
    'plate', case when (s.options->>'show_plate_masked')::boolean and v.id is not null then mask_plate(v.plate_normalized) end,
    'driver_first_name', case when (s.options->>'show_driver_first_name')::boolean and d.id is not null then split_part(d.full_name, ' ', 1) end,
    'server_time', now()
  );
  return result;
end $$;


-- Partilha: a primeira usa o código da viagem; o DTO público mostra o código da partilha.
create or replace function share_create(p_trip uuid, p_stop uuid, p_token_hash text, p_expires timestamptz, p_options jsonb)
returns tracking_shares language plpgsql security definer set search_path = public as $$
declare t trips; s tracking_shares; lim int; cnt int; code text; tries int := 0;
begin
  select * into t from trips where id = p_trip and deleted_at is null;
  if t.id is null or not can_write(t.organization_id) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  lim := plan_limit(t.organization_id, 'max_active_shares');
  select count(*) into cnt from tracking_shares where organization_id = t.organization_id and is_active and revoked_at is null and expires_at > now();
  if lim is not null and cnt >= lim then raise exception 'limite_plano:max_active_shares' using errcode = 'P0001'; end if;
  -- 1.ª partilha usa o próprio código da viagem (o que o dono vê e dita); ao regenerar, código novo.
  if not exists (select 1 from tracking_shares where short_code = t.code) then code := t.code; else
  loop
    code := gen_ft_code(); tries := tries + 1;
    exit when not exists (select 1 from tracking_shares where short_code = code) and not exists (select 1 from trips where trips.code = code) or tries > 5;
  end loop;
  end if;
  insert into tracking_shares (organization_id, trip_id, stop_id, short_code, token_hash, expires_at, options, created_by)
  values (t.organization_id, t.id, p_stop, code, p_token_hash, p_expires,
          coalesce(p_options, '{"show_company":true,"show_logo":true,"show_plate_masked":false,"show_driver_first_name":false}'::jsonb), app_user_id())
  returning * into s;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (t.organization_id, 'member', app_user_id(), 'partilha.criar', 'tracking_shares', s.id);
  return s;
end $$;

