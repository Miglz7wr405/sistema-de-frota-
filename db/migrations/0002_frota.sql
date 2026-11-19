-- 0002 — Frota: ficheiros, camiões, motoristas, documentos, acesso do motorista, dispositivos GPS.
-- Reversão: 0002_frota.down.sql.

-- Ficheiros privados (fotografias, documentos, recibos, assinaturas).
-- Guardados na própria BD (bytea, ≤ 2 MB depois de comprimidos no navegador) — ver ADR-017.
create table files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('vehicle_photo','driver_photo','document','receipt','delivery_photo','signature','incident_photo','logo')),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 2097152),
  data bytea not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on files (organization_id);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plate text not null check (length(trim(plate)) between 3 and 15),
  plate_normalized text generated always as (upper(regexp_replace(trim(plate), '\s+', ' ', 'g'))) stored,
  make text, model text,
  year int check (year between 1950 and 2100),
  body_type text not null default 'rigido' check (body_type in ('rigido','trator','basculante','cisterna','frigorifico','outro')),
  capacity_t numeric(6,2) check (capacity_t > 0),
  gross_weight_t numeric(6,2) check (gross_weight_t > 0),
  length_m numeric(5,2) check (length_m > 0),
  width_m numeric(4,2) check (width_m > 0),
  height_m numeric(4,2) check (height_m > 0),
  axles int check (axles between 2 and 12),
  odometer_km numeric(10,1) check (odometer_km >= 0),
  photo_file_id uuid references files(id) on delete set null,
  admin_status text not null default 'ativo' check (admin_status in ('ativo','em_manutencao','inativo')),
  gps_source_priority text not null default 'device' check (gps_source_priority in ('device','phone')),
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vehicles_plate_uq on vehicles (organization_id, plate_normalized) where deleted_at is null;
create trigger t_veh_upd before update on vehicles for each row execute function set_updated_at();

create table drivers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null check (length(full_name) between 2 and 120),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  license_number text,
  license_category text,
  photo_file_id uuid references files(id) on delete set null,
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index drivers_phone_uq on drivers (organization_id, phone) where deleted_at is null;
create trigger t_drv_upd before update on drivers for each row execute function set_updated_at();

create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  driver_id uuid references drivers(id) on delete cascade,
  doc_type text not null check (doc_type in ('carta_conducao','seguro','inspecao','licenca_transporte','manifesto','livrete','outro')),
  number text,
  issued_on date,
  expires_on date,
  file_id uuid references files(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(vehicle_id, driver_id) = 1),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index on documents (organization_id, expires_on);
create trigger t_doc_upd before update on documents for each row execute function set_updated_at();

-- Acesso do motorista à PWA: link (token) + PIN. Só hashes (ADR-008).
create table driver_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  token_hash text not null unique,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index driver_access_one_active on driver_access (driver_id) where revoked_at is null;
create trigger t_dacc_upd before update on driver_access for each row execute function set_updated_at();

create table driver_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  access_id uuid not null references driver_access(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table driver_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  consent_version text not null,
  accepted_at timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, consent_version)
);

-- Dispositivos GPS físicos e histórico de associação (correção 12).
create table gps_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  imei text not null unique check (imei ~ '^[0-9]{10,20}$'),
  protocol text,
  model text,
  sim_phone text check (sim_phone is null or sim_phone ~ '^\+[1-9][0-9]{7,14}$'),
  traccar_device_id bigint,
  last_contact_at timestamptz,
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_dev_upd before update on gps_devices for each row execute function set_updated_at();

create table device_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  device_id uuid not null references gps_devices(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (device_id with =, tstzrange(valid_from, coalesce(valid_to, 'infinity')) with &&),
  exclude using gist (vehicle_id with =, tstzrange(valid_from, coalesce(valid_to, 'infinity')) with &&)
);

-- Chaves de ingestão (Traccar / simulador), por organização. Só o hash.
create table ingest_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  scope text not null check (scope in ('traccar','simulator')),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Limites do plano aplicados na BD.
create or replace function enforce_plan_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int; key text := tg_argv[0];
begin
  lim := plan_limit(new.organization_id, key);
  if lim is null then return new; end if;
  execute format('select count(*) from %I where organization_id = $1 and %s', tg_table_name,
    case tg_table_name when 'vehicles' then 'deleted_at is null' when 'gps_devices' then 'deleted_at is null' else 'true' end)
    into cnt using new.organization_id;
  if cnt >= lim then
    raise exception 'limite_plano:%', key using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger t_veh_limit before insert on vehicles for each row execute function enforce_plan_limit('max_vehicles');
create trigger t_dev_limit before insert on gps_devices for each row execute function enforce_plan_limit('max_devices');
create trigger t_mem_limit before insert on organization_members for each row execute function enforce_plan_limit('max_members');

-- Funções de sessão do motorista (antes de haver contexto).
create or replace function driver_access_lookup(p_token_hash text)
returns table (access_id uuid, driver_id uuid, organization_id uuid, pin_hash text, locked_until timestamptz, revoked boolean, driver_active boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.driver_id, a.organization_id, a.pin_hash, a.locked_until, a.revoked_at is not null,
         d.status = 'ativo' and d.deleted_at is null
  from driver_access a join drivers d on d.id = a.driver_id where a.token_hash = p_token_hash
$$;

create or replace function driver_access_attempt(p_access uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update driver_access set failed_attempts = 0, locked_until = null, last_used_at = now() where id = p_access;
  else
    update driver_access set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where id = p_access;
  end if;
end $$;

create or replace function driver_session_create(p_access uuid, p_token_hash text, p_ttl_hours int) returns void
language sql security definer set search_path = public as $$
  insert into driver_sessions (organization_id, driver_id, access_id, token_hash, expires_at)
  select organization_id, driver_id, id, p_token_hash, now() + make_interval(hours => p_ttl_hours)
  from driver_access where id = p_access and revoked_at is null
$$;

create or replace function driver_session_resolve(p_token_hash text)
returns table (driver_id uuid, organization_id uuid, full_name text, revoked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.driver_id, s.organization_id, d.full_name, coalesce(s.revoked_at, a.revoked_at)
  from driver_sessions s join driver_access a on a.id = s.access_id join drivers d on d.id = s.driver_id
  where s.token_hash = p_token_hash and s.expires_at > now()
$$;

create or replace function ingest_key_resolve(p_key_hash text)
returns table (key_id uuid, organization_id uuid, scope text)
language plpgsql security definer set search_path = public as $$
begin
  return query update ingest_keys k set last_used_at = now()
    where k.key_hash = p_key_hash and k.revoked_at is null returning k.id, k.organization_id, k.scope;
end $$;
