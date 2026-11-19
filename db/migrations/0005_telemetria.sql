-- 0005 — Telemetria: posições (particionadas por mês), última posição, rejeições, percursos simplificados.
-- Reversão: 0005_telemetria.down.sql.

create table vehicle_positions (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  vehicle_id uuid not null,
  trip_id uuid,
  source text not null check (source in ('device','phone','simulator')),
  source_id text not null,               -- 'device:<uuid>' | 'driver:<uuid>' | 'sim:<key uuid>'
  device_time timestamptz not null,
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  geom geography(Point, 4326) not null,
  speed_kmh real check (speed_kmh is null or speed_kmh >= 0),
  heading real check (heading is null or (heading >= 0 and heading < 360)),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  battery_pct smallint check (battery_pct is null or battery_pct between 0 and 100),
  ignition boolean,
  flags text[] not null default '{}',
  primary key (id, device_time),
  unique (source_id, device_time)
) partition by range (device_time);

create index on vehicle_positions (vehicle_id, device_time desc);
create index on vehicle_positions (trip_id, device_time) where trip_id is not null;
create index on vehicle_positions using brin (device_time);

-- Cria partições mensais (passado próximo + futuro). Chamada pela migração e pelo job agendado.
create or replace function ensure_position_partitions(p_months_back int default 1, p_months_ahead int default 2)
returns int language plpgsql security definer set search_path = public as $$
declare m date; created int := 0; nm text;
begin
  for i in -p_months_back..p_months_ahead loop
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    nm := 'vehicle_positions_' || to_char(m, 'YYYY_MM');
    if to_regclass(nm) is null then
      execute format('create table %I partition of vehicle_positions for values from (%L) to (%L)',
        nm, m, (m + interval '1 month')::date);
      execute format('alter table %I enable row level security', nm);
      created := created + 1;
    end if;
  end loop;
  return created;
end $$;
select ensure_position_partitions(1, 2);
create table vehicle_positions_default partition of vehicle_positions default;

create table vehicle_latest_positions (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid,
  source text not null,
  source_id text not null,
  device_time timestamptz not null,
  received_at timestamptz not null,
  geom geography(Point, 4326) not null,
  speed_kmh real,
  heading real,
  accuracy_m real,
  battery_pct smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on vehicle_latest_positions (organization_id);

create table ingest_rejections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  source_id text,
  reason text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ingest_rejections (organization_id, received_at desc);

create table trip_tracks (
  trip_id uuid primary key references trips(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  geom geography(LineString, 4326),
  points_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ingestão (ADR-004/§6.8): grava o lote, sem duplicados, associa à viagem ativa no instante,
-- atualiza a última posição só se for mais recente (e respeitando a prioridade da fonte, L9).
-- Chamada SÓ pela API depois de autenticar a fonte e validar os pontos.
create or replace function ingest_positions(p_org uuid, p_vehicle uuid, p_source text, p_source_id text, p_points jsonb)
returns table (id uuid, device_time timestamptz, trip_id uuid, lng double precision, lat double precision,
               speed_kmh real, heading real, accuracy_m real, flags text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare pt jsonb; dt timestamptz; t uuid; new_id uuid; prio text; cur vehicle_latest_positions; take boolean;
begin
  if not exists (select 1 from vehicles v where v.id = p_vehicle and v.organization_id = p_org and v.deleted_at is null) then
    raise exception 'veiculo_invalido' using errcode = '42501';
  end if;
  select gps_source_priority into prio from vehicles where vehicles.id = p_vehicle;

  for pt in select * from jsonb_array_elements(p_points) order by (value->>'device_time')::timestamptz loop
    dt := (pt->>'device_time')::timestamptz;
    select tr.id into t from trips tr
     where tr.vehicle_id = p_vehicle and tr.deleted_at is null and tr.status <> 'cancelada'
       and tr.actual_departure is not null and tr.actual_departure <= dt
       and (tr.actual_arrival is null or tr.actual_arrival >= dt)
     order by tr.actual_departure desc limit 1;

    insert into vehicle_positions (organization_id, vehicle_id, trip_id, source, source_id, device_time, sent_at,
                                   geom, speed_kmh, heading, accuracy_m, battery_pct, ignition, flags)
    values (p_org, p_vehicle, t, p_source, p_source_id, dt, (pt->>'sent_at')::timestamptz,
            ST_SetSRID(ST_MakePoint((pt->>'lng')::float8, (pt->>'lat')::float8), 4326)::geography,
            (pt->>'speed_kmh')::real, (pt->>'heading')::real, (pt->>'accuracy_m')::real,
            (pt->>'battery_pct')::smallint, (pt->>'ignition')::boolean,
            coalesce(array(select jsonb_array_elements_text(pt->'flags')), '{}'))
    on conflict on constraint vehicle_positions_source_id_device_time_key do nothing
    returning vehicle_positions.id into new_id;

    if new_id is null then continue; end if; -- duplicado

    select * into cur from vehicle_latest_positions where vehicle_latest_positions.vehicle_id = p_vehicle for update;
    take := cur.vehicle_id is null
         or (dt > cur.device_time and (
               cur.source_id = p_source_id
               or (case when p_source = 'device' then 'device' else 'phone' end) = prio
               or cur.device_time < now() - interval '2 minutes'));
    if take then
      insert into vehicle_latest_positions (vehicle_id, organization_id, trip_id, source, source_id, device_time, received_at,
                                            geom, speed_kmh, heading, accuracy_m, battery_pct)
      values (p_vehicle, p_org, t, p_source, p_source_id, dt, now(),
              ST_SetSRID(ST_MakePoint((pt->>'lng')::float8, (pt->>'lat')::float8), 4326)::geography,
              (pt->>'speed_kmh')::real, (pt->>'heading')::real, (pt->>'accuracy_m')::real, (pt->>'battery_pct')::smallint)
      on conflict (vehicle_id) do update set trip_id = excluded.trip_id, source = excluded.source, source_id = excluded.source_id,
        device_time = excluded.device_time, received_at = excluded.received_at, geom = excluded.geom,
        speed_kmh = excluded.speed_kmh, heading = excluded.heading, accuracy_m = excluded.accuracy_m,
        battery_pct = excluded.battery_pct, updated_at = now();
    end if;

    return query select new_id, dt, t, (pt->>'lng')::float8, (pt->>'lat')::float8, (pt->>'speed_kmh')::real,
      (pt->>'heading')::real, (pt->>'accuracy_m')::real, coalesce(array(select jsonb_array_elements_text(pt->'flags')), '{}');
  end loop;

  insert into usage_counters (organization_id, period, positions_ingested)
    values (p_org, date_trunc('month', now())::date, jsonb_array_length(p_points))
  on conflict (organization_id, period) do update set positions_ingested = usage_counters.positions_ingested + excluded.positions_ingested;
end $$;

-- Última posição anterior aceite (para rejeitar saltos impossíveis).
create or replace function last_position_before(p_vehicle uuid, p_source_id text, p_time timestamptz)
returns table (device_time timestamptz, lng double precision, lat double precision)
language sql stable security definer set search_path = public as $$
  select v.device_time, ST_X(v.geom::geometry), ST_Y(v.geom::geometry) from vehicle_positions v
  where v.vehicle_id = p_vehicle and v.source_id = p_source_id and v.device_time < p_time
    and v.device_time > p_time - interval '2 days'
  order by v.device_time desc limit 1
$$;

create or replace function log_ingest_rejection(p_org uuid, p_source_id text, p_reason text, p_payload jsonb) returns void
language sql security definer set search_path = public as $$
  insert into ingest_rejections (organization_id, source_id, reason, payload) values (p_org, p_source_id, p_reason, p_payload)
$$;

-- Percurso simplificado ao concluir (replay barato e permanente).
create or replace function build_trip_track(p_trip uuid) returns void
language sql security definer set search_path = public as $$
  insert into trip_tracks (trip_id, organization_id, geom, points_count)
  select p_trip, max(organization_id::text)::uuid,
         case when count(*) >= 2 then ST_SimplifyPreserveTopology(ST_MakeLine(geom::geometry order by device_time), 0.0001)::geography end,
         count(*)
  from vehicle_positions where trip_id = p_trip and not ('rejected' = any(flags))
  having count(*) > 0
  on conflict (trip_id) do update set geom = excluded.geom, points_count = excluded.points_count, updated_at = now()
$$;

-- Retenção por plano: apaga posições fora da retenção e partições antigas inteiras.
create or replace function apply_position_retention() returns int
language plpgsql security definer set search_path = public as $$
declare max_days int; r record; deleted int := 0; n int;
begin
  select max((limits->>'retention_days')::int) into max_days from plans;
  for r in select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
           where i.inhparent = 'vehicle_positions'::regclass and c.relname ~ '^vehicle_positions_\d{4}_\d{2}$' loop
    if to_date(substr(r.relname, 19), 'YYYY_MM') + interval '1 month' < now() - make_interval(days => max_days) then
      execute format('drop table %I', r.relname);
    end if;
  end loop;
  for r in select s.organization_id, (p.limits->>'retention_days')::int as days
           from subscriptions s join plans p on p.id = s.plan_id where s.status <> 'canceled' loop
    delete from vehicle_positions where organization_id = r.organization_id and device_time < now() - make_interval(days => r.days);
    get diagnostics n = row_count; deleted := deleted + n;
  end loop;
  return deleted;
end $$;
