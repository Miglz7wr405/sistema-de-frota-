-- 0003 — Viagens: viagens, paragens, eventos, máquina de estados, ocorrências, comprovativos.
-- Reversão: 0003_viagens.down.sql.

create type trip_status as enum ('planeada','aguardando_partida','em_viagem','pausada','concluida','cancelada');

-- Código curto FT-XXXX-XXXX: Crockford Base32 sem 0, 1 (e sem I, L, O, U) → 30 símbolos, 8 caracteres ≈ 39 bits.
create or replace function gen_ft_code() returns text language plpgsql volatile as $$
declare alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ'; b bytea; s text := ''; i int;
begin
  b := gen_random_bytes(8);
  for i in 0..7 loop
    -- rejeição simples para evitar viés: bytes ≥ 240 são novamente sorteados
    while get_byte(b, i) >= 240 loop b := set_byte(b, i, get_byte(gen_random_bytes(1), 0)); end loop;
    s := s || substr(alphabet, (get_byte(b, i) % 30) + 1, 1);
  end loop;
  return 'FT-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
end $$;

create table places (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null = público (importado)
  name text not null,
  name_variants text[] not null default '{}',
  kind text not null check (kind in ('city','town','village','locality','bridge','toll','checkpoint','weighbridge','fuel','border',
                                     'warehouse','customer','depot','workshop','other')),
  importance smallint not null default 1 check (importance between 1 and 5),
  province_id uuid,
  district_id uuid,
  geom geography(Point, 4326) not null,
  osm_id text,
  dataset_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (organization_id is null or osm_id is null)
);
create index places_geom_gix on places using gist (geom);
create index places_name_trgm on places using gin (name gin_trgm_ops);
create unique index places_osm_uq on places (osm_id) where osm_id is not null;
create trigger t_pl_upd before update on places for each row execute function set_updated_at();

create table trips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null unique default gen_ft_code(),
  vehicle_id uuid references vehicles(id) on delete restrict,
  driver_id uuid references drivers(id) on delete restrict,
  origin_place_id uuid not null references places(id),
  destination_place_id uuid not null references places(id),
  status trip_status not null default 'planeada',
  planned_departure timestamptz,
  planned_arrival timestamptz,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  cargo_description text,
  cargo_weight_t numeric(7,2) check (cargo_weight_t >= 0),
  recipient_name text,
  recipient_phone text check (recipient_phone is null or recipient_phone ~ '^\+[1-9][0-9]{7,14}$'),
  client_reference text,
  notes text,
  cancel_reason text,
  deleted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_arrival is null or planned_departure is null or planned_arrival > planned_departure),
  check (origin_place_id <> destination_place_id)
);
create unique index trips_one_active_vehicle on trips (vehicle_id) where status in ('em_viagem','pausada') and deleted_at is null;
create unique index trips_one_active_driver on trips (driver_id) where status in ('em_viagem','pausada') and deleted_at is null;
create index on trips (organization_id, status);
create index on trips (organization_id, created_at desc);
create trigger t_trip_upd before update on trips for each row execute function set_updated_at();

create table trip_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  seq int not null check (seq >= 1),
  kind text not null default 'passagem' check (kind in ('entrega','recolha','passagem')),
  place_id uuid not null references places(id),
  recipient_name text,
  recipient_phone text check (recipient_phone is null or recipient_phone ~ '^\+[1-9][0-9]{7,14}$'),
  planned_at timestamptz,
  arrived_at timestamptz,
  departed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, seq)
);
create trigger t_stop_upd before update on trip_stops for each row execute function set_updated_at();

create table trip_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  kind text not null,
  occurred_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('member','driver','system')),
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  position geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on trip_events (trip_id, occurred_at);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  kind text not null check (kind in ('avaria','acidente','controlo_policial','estrada_cortada','outra')),
  note text,
  photo_file_id uuid references files(id) on delete set null,
  occurred_at timestamptz not null default now(),
  position geography(Point, 4326),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  stop_id uuid references trip_stops(id) on delete set null,
  received_by_name text not null check (length(received_by_name) >= 2),
  signature_file_id uuid references files(id) on delete set null,
  photo_file_id uuid references files(id) on delete set null,
  delivered_at timestamptz not null default now(),
  position geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Máquina de estados (SPEC §6.6). Única forma de mudar o estado de uma viagem. ──
create or replace function trip_transition(p_trip uuid, p_to trip_status, p_reason text default null)
returns trips language plpgsql security definer set search_path = public as $$
declare t trips; actor_type text; actor uuid; allowed boolean := false; is_mgr boolean; is_drv boolean;
begin
  select * into t from trips where id = p_trip and deleted_at is null for update;
  if t.id is null then raise exception 'viagem_inexistente' using errcode = 'P0002'; end if;

  is_mgr := app_user_id() is not null and can_write(t.organization_id);
  is_drv := app_driver_id() is not null and t.driver_id = app_driver_id();
  if not (is_mgr or is_drv) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  actor_type := case when is_mgr then 'member' else 'driver' end;
  actor := coalesce(app_user_id(), app_driver_id());

  allowed := case
    when t.status = 'planeada' and p_to = 'aguardando_partida' then is_mgr
    when t.status in ('planeada','aguardando_partida') and p_to = 'em_viagem' then is_mgr or is_drv
    when t.status = 'em_viagem' and p_to = 'pausada' then true
    when t.status = 'pausada' and p_to = 'em_viagem' then true
    when t.status in ('em_viagem','pausada') and p_to = 'concluida' then true
    when t.status in ('planeada','aguardando_partida','em_viagem','pausada') and p_to = 'cancelada' then is_mgr
    else false end;
  if not allowed then
    raise exception 'transicao_invalida:%->%', t.status, p_to using errcode = 'P0001';
  end if;
  if p_to = 'em_viagem' and (t.vehicle_id is null or t.driver_id is null) then
    raise exception 'viagem_sem_camiao_ou_motorista' using errcode = 'P0001';
  end if;
  if p_to = 'cancelada' and coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'motivo_obrigatorio' using errcode = 'P0001';
  end if;

  update trips set status = p_to,
    actual_departure = case when p_to = 'em_viagem' and actual_departure is null then now() else actual_departure end,
    actual_arrival = case when p_to = 'concluida' then now() else actual_arrival end,
    cancel_reason = case when p_to = 'cancelada' then p_reason else cancel_reason end
  where id = p_trip returning * into t;

  insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload)
  values (t.organization_id, t.id,
    case p_to when 'em_viagem' then (case when t.actual_departure >= now() - interval '1 second' then 'partida' else 'retomada' end)
              when 'pausada' then 'pausa' when 'concluida' then 'chegada' when 'cancelada' then 'cancelamento'
              else 'estado' end,
    actor_type, actor, jsonb_build_object('para', p_to, 'motivo', p_reason));
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
  values (t.organization_id, actor_type, actor, 'viagem.estado', 'trips', t.id, jsonb_build_object('status', p_to));
  return t;
end $$;

-- Impede mudar o estado por UPDATE direto (só via trip_transition, que corre como dono).
create or replace function trips_guard_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and current_user = 'app_api' then
    raise exception 'use_trip_transition' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_trip_guard before update on trips for each row execute function trips_guard_status();
