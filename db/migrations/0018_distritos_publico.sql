-- 0018 — Distritos visíveis ao cliente: lista dos distritos atravessados pela rota e o distrito da última posição real,
-- na lista branca do DTO público (sem geometria, sem dados privados). A função route_districts é a mesma lógica usada
-- pela app do motorista (server/trip-route.ts): amostra a rota a cada 400 m e regista as mudanças de distrito (ADM2).
-- Reversão: repor public_trip_dto de 0015_estrada_e_teste_real.sql e "drop function route_districts(uuid)".
create or replace function route_districts(p_route uuid)
returns table (code text, name text, province text, km double precision)
language sql stable set search_path = public as $$
  with r as (select geom::geometry g, length_m, base_km from trip_routes where id = p_route),
  pts as (select ST_LineLocatePoint(r.g, d.geom) f, d.geom p from r, ST_DumpPoints(ST_Segmentize(r.g::geography, 400)::geometry) d),
  lab as (select f, (select a.id from admin_areas a where a.level = 2 and ST_Covers(a.geom, p::geography) order by ST_Area(a.geom) limit 1) aid from pts),
  runs as (select f, aid, lag(aid) over (order by f) prev from lab where aid is not null),
  -- entradas; passagens de menos de 1 km por um distrito (ex.: a estrada a tocar num limite) não contam
  ent as (select f, aid, lead(f) over (order by f) nf from runs where aid is distinct from prev),
  firm as (select f, aid from ent where nf is null or (nf - f) * (select length_m from r) >= 1000),
  fin as (select f, aid, lag(aid) over (order by f) prev from firm)
  select a.code, a.name, pv.name, ((select base_km from r) + fin.f * (select length_m from r) / 1000)::float8
  from fin join admin_areas a on a.id = fin.aid left join admin_areas pv on pv.id = a.parent_id
  where fin.aid is distinct from fin.prev order by fin.f
$$;

create or replace function public_trip_dto(p_share uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s tracking_shares; t trips; o organizations; v vehicles; d drivers; p trip_progress; lp vehicle_latest_positions;
        r trip_routes; active boolean; result jsonb; places_json jsonb; done_geo jsonb; left_geo jsonb; frac double precision;
        dist_json jsonb; cur_district jsonb;
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

  -- distritos atravessados pela rota (nome, província, km desde a origem) e o distrito da última posição real
  select coalesce(jsonb_agg(jsonb_build_object('name', rd.name, 'province', rd.province, 'km', round(rd.km::numeric, 1)) order by rd.km), '[]'::jsonb)
    into dist_json from route_districts(r.id) rd where r.id is not null;
  if active and lp.vehicle_id is not null then
    select jsonb_build_object('name', a.name, 'province', pv.name) into cur_district
    from admin_areas a left join admin_areas pv on pv.id = a.parent_id
    where a.level = 2 and ST_Covers(a.geom, coalesce(lp.matched_geom, lp.geom))
    order by ST_Area(a.geom) limit 1;
  end if;

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
    'districts', coalesce(dist_json, '[]'::jsonb),
    'district', cur_district,
    'company', case when (s.options->>'show_company')::boolean then coalesce(o.public_name, o.name) end,
    'logo_file_id', case when (s.options->>'show_logo')::boolean and o.logo_file_id is not null then s.id end,
    'plate', case when (s.options->>'show_plate_masked')::boolean and v.id is not null then mask_plate(v.plate_normalized) end,
    'driver_first_name', case when (s.options->>'show_driver_first_name')::boolean and d.id is not null then split_part(d.full_name, ' ', 1) end,
    'server_time', now()
  );
  return result;
end $$;
