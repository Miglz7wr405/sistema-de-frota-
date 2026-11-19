-- 0004 — Geografia e percurso: datasets, áreas administrativas, cache de rotas, rotas da viagem,
-- localidades da rota, progresso, estatísticas de velocidade, avisos por voz.
-- Reversão: 0004_percurso.down.sql.

create table geo_datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_url text not null,
  license text not null,
  retrieved_at timestamptz not null,
  version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin_areas (
  id uuid primary key default gen_random_uuid(),
  level smallint not null check (level in (1, 2)),
  name text not null,
  code text not null,
  parent_id uuid references admin_areas(id) on delete cascade,
  geom geography(MultiPolygon, 4326) not null,
  dataset_id uuid references geo_datasets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (level, code)
);
create index admin_areas_gix on admin_areas using gist (geom);

alter table places add constraint places_province_fk foreign key (province_id) references admin_areas(id) on delete set null;
alter table places add constraint places_district_fk foreign key (district_id) references admin_areas(id) on delete set null;
alter table places add constraint places_dataset_fk foreign key (dataset_id) references geo_datasets(id) on delete set null;

create table route_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  provider text not null,
  profile jsonb not null,
  geom geography(LineString, 4326) not null,
  cum_m double precision[] not null,
  length_m double precision not null check (length_m > 0),
  duration_s double precision not null check (duration_s > 0),
  roads text[] not null default '{}',
  validated_for_truck boolean not null default false,
  hits int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trip_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  version int not null check (version >= 1),
  reason text not null check (reason in ('plan','deviation','edit')),
  provider text not null,
  geom geography(LineString, 4326) not null,
  cum_m double precision[] not null,
  length_m double precision not null check (length_m > 0),
  duration_s double precision not null check (duration_s > 0),
  roads text[] not null default '{}',
  validated_for_truck boolean not null default false,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, version)
);
create unique index trip_routes_current on trip_routes (trip_id) where is_current;

create table trip_route_places (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_route_id uuid not null references trip_routes(id) on delete cascade,
  place_id uuid not null references places(id),
  seq int not null,
  km_from_origin double precision not null check (km_from_origin >= 0),
  offset_m double precision not null default 0, -- distância perpendicular da localidade à rota
  state text not null default 'proxima' check (state in ('proxima','atual','passada')),
  eta timestamptz,
  eta_confidence text check (eta_confidence in ('alta','media','baixa','indisponivel')),
  passed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_route_id, seq)
);
create trigger t_trp_upd before update on trip_route_places for each row execute function set_updated_at();

-- Estado de progresso por viagem (uma linha), escrito pela ingestão. O motor é src/lib/geo/progress.ts.
create table trip_progress (
  trip_id uuid primary key references trips(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_route_id uuid references trip_routes(id) on delete set null,
  km_done double precision,
  km_left double precision,
  pct double precision check (pct between 0 and 100),
  current_label text,
  current_place_id uuid references places(id),
  next_place_id uuid references places(id),
  province_id uuid references admin_areas(id),
  eta_destination timestamptz,
  eta_confidence text not null default 'indisponivel' check (eta_confidence in ('alta','media','baixa','indisponivel')),
  speed_kmh_smoothed double precision,
  last_position_at timestamptz,
  engine_state jsonb not null default '{}'::jsonb, -- estado interno do motor (último ponto projetado, desvio, paragem)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_tp_upd before update on trip_progress for each row execute function set_updated_at();

-- Velocidades típicas por troço (aprendidas com viagens concluídas). Sem dados pessoais.
create table segment_speed_stats (
  id uuid primary key default gen_random_uuid(),
  route_signature text not null,
  segment_idx int not null,
  p50_kmh double precision not null,
  samples int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_signature, segment_idx)
);

create table voice_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  idempotency_key text not null,
  kind text not null,
  text text not null,
  triggered_at timestamptz not null,
  km_at double precision,
  played boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, idempotency_key)
);

-- Lista de localidades ao longo de uma rota (horário de comboio), a partir da geometria.
-- Só localidades públicas e privadas da organização, com importância mínima, a ≤ p_buffer_m da estrada.
create or replace function places_along_route(p_geom geography, p_org uuid, p_min_importance int, p_buffer_m double precision)
returns table (place_id uuid, name text, kind text, importance smallint, province_id uuid, fraction double precision, offset_m double precision)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.kind, p.importance, p.province_id,
         ST_LineLocatePoint(p_geom::geometry, p.geom::geometry) as fraction,
         ST_Distance(p.geom, p_geom) as offset_m
  from places p
  where p.deleted_at is null
    and (p.organization_id is null or p.organization_id = p_org)
    and p.importance >= p_min_importance
    and ST_DWithin(p.geom, p_geom, p_buffer_m)
  order by fraction
$$;

create or replace function province_at(p_lng double precision, p_lat double precision)
returns table (id uuid, name text) language sql stable security definer set search_path = public as $$
  select a.id, a.name from admin_areas a
  where a.level = 1 and ST_Covers(a.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) limit 1
$$;
