-- 0015 — Dados reais da estrada (ajuste à estrada, nome, limite de velocidade do OSM) e teste com o telemóvel do utilizador.
-- Reversão: remover as colunas acrescentadas (alter table ... drop column ...).

-- Última posição: posição ajustada à estrada (map matching do Valhalla) + estrada + limite (só se etiquetado no OSM).
alter table vehicle_latest_positions
  add column matched_geom geography(Point, 4326),
  add column road_name text,
  add column speed_limit_kmh smallint check (speed_limit_kmh is null or speed_limit_kmh between 5 and 200),
  add column matched_at timestamptz;

alter table trip_progress
  add column road_name text,
  add column speed_limit_kmh smallint check (speed_limit_kmh is null or speed_limit_kmh between 5 and 200);

-- Motorista ligado a um membro (o dono a testar com o próprio telemóvel). Nulo para motoristas normais.
alter table drivers add column user_id uuid references app_users(id) on delete set null;
create unique index drivers_user_uq on drivers (organization_id, user_id) where user_id is not null and deleted_at is null;
alter table vehicles add column is_test boolean not null default false;


-- Página pública: o camião aparece em cima da estrada quando há ajuste da última posição; senão, posição GPS bruta.
-- Mesmos campos da lista branca. Reversão: repor a função de 0012.
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
        'lng', round(ST_X((case when lp.matched_geom is not null and lp.matched_at >= lp.device_time - interval '1 second' then lp.matched_geom else lp.geom end)::geometry)::numeric, 5),
        'lat', round(ST_Y((case when lp.matched_geom is not null and lp.matched_at >= lp.device_time - interval '1 second' then lp.matched_geom else lp.geom end)::geometry)::numeric, 5),
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

-- O camião de teste (o telemóvel do dono) não conta para o limite do plano; no máximo 1 por organização.
-- Reversão: repor enforce_plan_limit de 0002 e apagar o índice.
create unique index vehicles_test_uq on vehicles (organization_id) where is_test and deleted_at is null;
create or replace function enforce_plan_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int; key text := tg_argv[0];
begin
  if tg_table_name = 'vehicles' then
    if (to_jsonb(new)->>'is_test')::boolean then return new; end if;
  end if;
  lim := plan_limit(new.organization_id, key);
  if lim is null then return new; end if;
  execute format('select count(*) from %I where organization_id = $1 and %s', tg_table_name,
    case tg_table_name when 'vehicles' then 'deleted_at is null and not is_test' when 'gps_devices' then 'deleted_at is null' else 'true' end)
    into cnt using new.organization_id;
  if cnt >= lim then
    raise exception 'limite_plano:%', key using errcode = 'P0001';
  end if;
  return new;
end $$;
