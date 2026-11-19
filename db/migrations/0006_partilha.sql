-- 0006 — Rastreamento público: partilhas, registo de acessos, limitação de taxa, DTO público (lista branca).
-- Reversão: 0006_partilha.down.sql.

create table tracking_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  stop_id uuid references trip_stops(id) on delete cascade,
  short_code text not null unique,      -- FT-XXXX-XXXX (para ditar)
  token_hash text not null unique,      -- sha256 do token de 128 bits (o token nunca é guardado)
  expires_at timestamptz not null,
  revoked_at timestamptz,
  is_active boolean not null default true,
  options jsonb not null default '{"show_company":true,"show_logo":true,"show_plate_masked":false,"show_driver_first_name":false}'::jsonb,
  views_count int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tracking_shares (trip_id);
create trigger t_ts_upd before update on tracking_shares for each row execute function set_updated_at();

create table tracking_access_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  share_id uuid not null references tracking_shares(id) on delete cascade,
  accessed_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  via text not null check (via in ('code','link','preview')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tracking_access_logs (share_id, accessed_at desc);

-- Janela fixa de limitação de taxa (usada pela API pública e pela ingestão).
create table rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket_key, window_start)
);

create or replace function rate_limit_hit(p_key text, p_window_s int, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s); c int;
begin
  insert into rate_limits (bucket_key, window_start, count) values (p_key, w, 1)
  on conflict (bucket_key, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  return c <= p_max; -- true = permitido
end $$;

-- Matrícula parcialmente oculta: "ADF 512 MP" → "ADF ••• MP".
create or replace function mask_plate(p text) returns text language sql immutable as $$
  select case when p ~ '^\S+\s+\S+\s+\S+$'
    then split_part(p, ' ', 1) || ' ••• ' || split_part(p, ' ', 3)
    else left(p, 2) || repeat('•', greatest(length(p) - 4, 1)) || right(p, 2) end
$$;

-- Resolve uma partilha por hash do token OU por código curto. Só devolve se ativa, válida e não revogada.
create or replace function public_share_resolve(p_token_hash text, p_code text)
returns table (share_id uuid, trip_id uuid, organization_id uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.trip_id, s.organization_id from tracking_shares s
  where (s.token_hash = p_token_hash or (p_code is not null and s.short_code = upper(p_code)))
    and s.is_active and s.revoked_at is null and s.expires_at > now()
  limit 1
$$;

create or replace function public_share_log(p_share uuid, p_ip_hash text, p_ua text, p_via text) returns void
language sql security definer set search_path = public as $$
  with s as (update tracking_shares set views_count = views_count + 1 where id = p_share returning organization_id)
  insert into tracking_access_logs (organization_id, share_id, ip_hash, user_agent, via)
  select organization_id, p_share, p_ip_hash, left(p_ua, 300), p_via from s
$$;

-- DTO PÚBLICO — lista branca de campos (SPEC §6.9). NUNCA: telefones, documentos, valores, IDs internos
-- de veículo/motorista, dados de outros clientes, histórico fora da viagem. Após entrega/cancelamento: sem posição.
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
    'code', t.code,
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
        'eta', case when p.eta_confidence <> 'indisponivel' then p.eta_destination end,
        'eta_confidence', p.eta_confidence) end,
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

-- Logótipo para a página pública (só se a partilha o permitir).
create or replace function public_share_logo(p_share uuid) returns table (content_type text, data bytea)
language sql stable security definer set search_path = public as $$
  select f.content_type, f.data from tracking_shares s join organizations o on o.id = s.organization_id
  join files f on f.id = o.logo_file_id
  where s.id = p_share and (s.options->>'show_logo')::boolean and s.revoked_at is null and s.expires_at > now()
$$;
