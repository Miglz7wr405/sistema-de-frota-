-- 0001 — Base: extensões, papel da aplicação, contexto de pedido, contas, organizações, planos, auditoria.
-- Reversão: ver 0001_base.down.sql (apaga tudo o que esta migração cria).

create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists btree_gist;
create extension if not exists pgcrypto;
create extension if not exists citext;

-- Papel usado pela API (Vercel Functions). NÃO é dono das tabelas → o RLS aplica-se sempre.
-- A palavra-passe NUNCA fica no repositório: é definida no deploy (ALTER ROLE ... LOGIN PASSWORD).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin;
  end if;
end $$;
grant usage on schema public to app_api;

-- ── Contexto do pedido (definido pela API com set_config(..., true) dentro da transação) ──
create or replace function app_user_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app_driver_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.driver_id', true), '')::uuid $$;

create or replace function set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;

-- ── Contas ──
create table app_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash text not null,
  full_name text not null check (length(full_name) between 2 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_app_users_upd before update on app_users for each row execute function set_updated_at();

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  active_org_id uuid,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on auth_sessions (user_id);

create table password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Planos e organizações ──
create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  limits jsonb not null default '{}'::jsonb,
  price numeric(14,2) not null default 0 check (price >= 0),
  currency char(3) not null default 'MZN',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_plans_upd before update on plans for each row execute function set_updated_at();

insert into plans (code, name, limits, price) values
 ('trial', 'Experimental', '{"max_vehicles":5,"max_devices":5,"max_members":3,"max_active_shares":20,"retention_days":30}', 0),
 ('basico', 'Básico', '{"max_vehicles":20,"max_devices":20,"max_members":10,"max_active_shares":200,"retention_days":30}', 0),
 ('frota', 'Frota', '{"max_vehicles":200,"max_devices":200,"max_members":50,"max_active_shares":5000,"retention_days":90}', 0);

create type org_role as enum ('owner', 'admin', 'dispatcher', 'viewer');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  province text,
  timezone text not null default 'Africa/Maputo',
  default_currency char(3) not null default 'MZN',
  settings jsonb not null default '{
     "freshness_current_s":120, "freshness_stale_s":900, "late_tolerance_min":30,
     "doc_alert_days":[30,15,7], "gps_interval_moving_s":15, "gps_interval_stopped_s":120,
     "deviation_corridor_m":500, "deviation_points":3, "deviation_min_minutes":3,
     "abnormal_stop_minutes":30, "voice_min_importance":3}'::jsonb,
  public_name text,
  logo_file_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_org_upd before update on organizations for each row execute function set_updated_at();

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role org_role not null,
  invited_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on organization_members (user_id);
create trigger t_mem_upd before update on organization_members for each row execute function set_updated_at();

create table organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email citext not null,
  role org_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references app_users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on organization_invites (organization_id, email) where accepted_at is null;
create trigger t_inv_upd before update on organization_invites for each row execute function set_updated_at();

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null default 'trial' check (status in ('trial','active','past_due','canceled')),
  period_start timestamptz not null default now(),
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on subscriptions (organization_id) where status <> 'canceled';
create trigger t_sub_upd before update on subscriptions for each row execute function set_updated_at();

create table usage_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  period date not null,
  positions_ingested bigint not null default 0,
  route_requests bigint not null default 0,
  public_views bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period)
);

-- Acesso de suporte da plataforma: temporário e auditado (SPEC §2).
create table support_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  reason text not null check (length(reason) >= 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  actor_type text not null check (actor_type in ('member','driver','system','platform','anonymous')),
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip_hash text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on audit_logs (organization_id, at desc);

-- ── Funções de permissão (SECURITY DEFINER para não haver recursão de RLS) ──
create or replace function is_member(org uuid, roles org_role[] default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = app_user_id()
      and (roles is null or m.role = any(roles))
  ) or (
    -- suporte da plataforma: só leitura (roles is null) e dentro da validade
    roles is null and exists (
      select 1 from support_grants g join app_users u on u.id = g.user_id
      where g.organization_id = org and g.user_id = app_user_id()
        and u.is_platform_admin and g.expires_at > now()
    )
  )
$$;

create or replace function can_write(org uuid) returns boolean language sql stable as
$$ select is_member(org, array['owner','admin','dispatcher']::org_role[]) $$;
create or replace function can_admin(org uuid) returns boolean language sql stable as
$$ select is_member(org, array['owner','admin']::org_role[]) $$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_platform_admin from app_users where id = app_user_id()), false) $$;

-- Tem de existir sempre pelo menos um owner.
create or replace function guard_last_owner() returns trigger language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  if (tg_op = 'DELETE' and old.role = 'owner') or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*) into remaining from organization_members
      where organization_id = old.organization_id and role = 'owner' and id <> old.id;
    if remaining = 0 and exists (select 1 from organizations where id = old.organization_id) then
      raise exception 'ultimo_owner' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger t_mem_last_owner before update or delete on organization_members
  for each row execute function guard_last_owner();

-- ── Funções de autenticação (chamadas pela API antes de haver contexto de utilizador) ──
create or replace function auth_register(p_email text, p_password_hash text, p_full_name text,
  p_org_name text, p_phone text, p_province text)
returns table (user_id uuid, organization_id uuid)
language plpgsql security definer set search_path = public as $$
declare u uuid; o uuid; trial uuid;
begin
  insert into app_users (email, password_hash, full_name, phone)
    values (p_email, p_password_hash, p_full_name, nullif(p_phone, '')) returning id into u;
  insert into organizations (name, phone, province) values (p_org_name, nullif(p_phone, ''), nullif(p_province, ''))
    returning id into o;
  insert into organization_members (organization_id, user_id, role) values (o, u, 'owner');
  select id into trial from plans where code = 'trial';
  insert into subscriptions (organization_id, plan_id, status, period_end) values (o, trial, 'trial', now() + interval '60 days');
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (o, 'member', u, 'organizacao.criar', 'organizations', o);
  return query select u, o;
end $$;

create or replace function auth_user_by_email(p_email text)
returns table (id uuid, password_hash text, full_name text)
language sql stable security definer set search_path = public as
$$ select id, password_hash, full_name from app_users where email = p_email $$;

create or replace function auth_session_create(p_user uuid, p_token_hash text, p_ua text, p_ttl_hours int)
returns uuid language plpgsql security definer set search_path = public as $$
declare s uuid; org uuid;
begin
  select organization_id into org from organization_members where user_id = p_user order by created_at limit 1;
  insert into auth_sessions (user_id, token_hash, user_agent, expires_at, active_org_id)
    values (p_user, p_token_hash, left(p_ua, 300), now() + make_interval(hours => p_ttl_hours), org)
    returning id into s;
  return s;
end $$;

create or replace function auth_session_resolve(p_token_hash text)
returns table (session_id uuid, user_id uuid, active_org_id uuid, is_platform_admin boolean, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, s.active_org_id, u.is_platform_admin, u.full_name, u.email::text
  from auth_sessions s join app_users u on u.id = s.user_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
$$;

create or replace function auth_session_revoke(p_token_hash text) returns void
language sql security definer set search_path = public as
$$ update auth_sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null $$;

create or replace function auth_session_switch_org(p_token_hash text, p_org uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update auth_sessions s set active_org_id = p_org
   where s.token_hash = p_token_hash and s.revoked_at is null
     and exists (select 1 from organization_members m where m.user_id = s.user_id and m.organization_id = p_org);
  return found;
end $$;

create or replace function auth_password_reset_create(p_email text, p_token_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select id into u from app_users where email = p_email;
  if u is null then return false; end if;
  insert into password_resets (user_id, token_hash, expires_at) values (u, p_token_hash, now() + interval '1 hour');
  return true;
end $$;

create or replace function auth_password_reset_use(p_token_hash text, p_new_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r password_resets;
begin
  select * into r from password_resets where token_hash = p_token_hash and used_at is null and expires_at > now() for update;
  if r.id is null then return false; end if;
  update password_resets set used_at = now() where id = r.id;
  update app_users set password_hash = p_new_hash where id = r.user_id;
  update auth_sessions set revoked_at = now() where user_id = r.user_id and revoked_at is null;
  return true;
end $$;

create or replace function auth_invite_accept(p_token_hash text, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i organization_invites; em citext;
begin
  select email into em from app_users where id = p_user;
  select * into i from organization_invites where token_hash = p_token_hash and accepted_at is null and expires_at > now() for update;
  if i.id is null or i.email <> em then return null; end if;
  insert into organization_members (organization_id, user_id, role, invited_by)
    values (i.organization_id, p_user, i.role, i.invited_by) on conflict (organization_id, user_id) do nothing;
  update organization_invites set accepted_at = now() where id = i.id;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (i.organization_id, 'member', p_user, 'membro.aceitar_convite', 'organization_members', p_user);
  return i.organization_id;
end $$;

-- ── Limites do plano (verificados na BD, SPEC §6.14) ──
create or replace function plan_limit(org uuid, key text) returns int
language sql stable security definer set search_path = public as $$
  select (p.limits ->> key)::int from subscriptions s join plans p on p.id = s.plan_id
  where s.organization_id = org and s.status <> 'canceled' limit 1
$$;
