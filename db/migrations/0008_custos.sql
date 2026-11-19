-- 0008 — Custos: combustível, manutenção (planos e registos), despesas de viagem.
-- Reversão: 0008_custos.down.sql.

create table fuel_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  trip_id uuid references trips(id) on delete set null,
  filled_at timestamptz not null,
  liters numeric(9,2) not null check (liters > 0),
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null default 'MZN',
  odometer_km numeric(10,1) check (odometer_km >= 0),
  station text,
  full_tank boolean not null default true,
  receipt_file_id uuid references files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on fuel_records (vehicle_id, filled_at);
create trigger t_fuel_upd before update on fuel_records for each row execute function set_updated_at();

create table maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  kind text not null,
  every_km numeric(10,1) check (every_km > 0),
  every_days int check (every_days > 0),
  last_done_at date,
  last_done_km numeric(10,1),
  next_due_at date generated always as (last_done_at + every_days) stored,
  next_due_km numeric(10,1) generated always as (last_done_km + every_km) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (every_km is not null or every_days is not null)
);
create trigger t_ms_upd before update on maintenance_schedules for each row execute function set_updated_at();

create table maintenance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  schedule_id uuid references maintenance_schedules(id) on delete set null,
  kind text not null,
  done_at date not null,
  odometer_km numeric(10,1) check (odometer_km >= 0),
  workshop text,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  currency char(3) not null default 'MZN',
  notes text,
  receipt_file_id uuid references files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_mr_upd before update on maintenance_records for each row execute function set_updated_at();

-- Registar uma manutenção atualiza o plano associado.
create or replace function maintenance_record_applied() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.schedule_id is not null then
    update maintenance_schedules set last_done_at = new.done_at, last_done_km = coalesce(new.odometer_km, last_done_km)
    where id = new.schedule_id and organization_id = new.organization_id;
  end if;
  return new;
end $$;
create trigger t_mr_apply after insert on maintenance_records for each row execute function maintenance_record_applied();

create table trip_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  category text not null check (category in ('portagem','alimentacao','alojamento','reparacao','outra')),
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null default 'MZN',
  spent_at timestamptz not null default now(),
  note text,
  receipt_file_id uuid references files(id) on delete set null,
  created_by_driver_id uuid references drivers(id) on delete set null,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on trip_expenses (trip_id);
create trigger t_te_upd before update on trip_expenses for each row execute function set_updated_at();

-- Consumo L/100 km entre abastecimentos de depósito cheio consecutivos (SPEC §6.13).
create or replace view fuel_consumption_v with (security_invoker = true) as
select f.id, f.organization_id, f.vehicle_id, f.filled_at, f.liters, f.odometer_km,
  prev.odometer_km as prev_odometer_km,
  case when f.full_tank and prev.odometer_km is not null and f.odometer_km > prev.odometer_km
       then round((f.liters * 100 / (f.odometer_km - prev.odometer_km))::numeric, 2) end as l_per_100km
from fuel_records f
left join lateral (
  select p.odometer_km from fuel_records p
  where p.vehicle_id = f.vehicle_id and p.full_tank and p.filled_at < f.filled_at and p.odometer_km is not null
  order by p.filled_at desc limit 1
) prev on true;
