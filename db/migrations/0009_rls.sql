-- 0009 — Segurança: RLS em TODAS as tabelas do schema public, permissões do papel app_api,
-- políticas por organização, políticas do motorista, vistas de estado.
-- Reversão: 0009_rls.down.sql (remove políticas, vistas e permissões; desativa RLS).

-- ── Ajudantes do contexto do motorista ──
create or replace function app_driver_org() returns uuid language sql stable security definer set search_path = public as
$$ select organization_id from drivers where id = app_driver_id() $$;
create or replace function driver_owns_trip(p_trip uuid) returns boolean language sql stable security definer set search_path = public as
$$ select app_driver_id() is not null and exists (select 1 from trips where id = p_trip and driver_id = app_driver_id() and deleted_at is null) $$;
create or replace function can_see_costs(org uuid) returns boolean language sql stable as
$$ select is_member(org, array['owner','admin','dispatcher']::org_role[]) $$;

-- ── RLS em todas as tabelas (incluindo partições) ──
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') and c.relname <> 'spatial_ref_sys' loop
    execute format('alter table %I enable row level security', t.relname);
  end loop;
end $$;

-- ── Permissões base do app_api ──
grant select, insert, update, delete on all tables in schema public to app_api;
revoke all on spatial_ref_sys from app_api;
grant select on spatial_ref_sys to app_api;
-- Tabelas de autenticação/segredos: só através de funções SECURITY DEFINER.
revoke all on auth_sessions, password_resets, driver_sessions, rate_limits, ingest_rejections from app_api;
revoke all on driver_access from app_api;
grant select (id, organization_id, driver_id, failed_attempts, locked_until, last_used_at, revoked_at, created_at) on driver_access to app_api;
grant update (revoked_at) on driver_access to app_api;
revoke all on app_users from app_api;
grant select (id, email, full_name, phone, is_platform_admin, created_at) on app_users to app_api;
grant update (full_name, phone) on app_users to app_api;
revoke all on ingest_keys from app_api;
grant select (id, organization_id, name, scope, last_used_at, revoked_at, created_at) on ingest_keys to app_api;
grant update (revoked_at) on ingest_keys to app_api;
revoke insert, update, delete on vehicle_positions, vehicle_latest_positions, trip_tracks, usage_counters, plans, subscriptions,
  support_grants, geo_datasets, admin_areas from app_api;
revoke update, delete on audit_logs from app_api;
grant usage on all sequences in schema public to app_api;

-- Ajudante para criar políticas de forma uniforme.
create or replace function _policy(tbl text, name text, cmd text, using_expr text, check_expr text default null) returns void
language plpgsql as $$
begin
  execute format('drop policy if exists %I on %I', name, tbl);
  execute format('create policy %I on %I for %s to app_api %s %s', name, tbl, cmd,
    case when cmd = 'insert' or using_expr is null then '' else 'using (' || using_expr || ')' end,
    case when check_expr is null then '' else 'with check (' || check_expr || ')' end);
end $$;

-- ── Contas e organizações ──
select _policy('app_users', 'sel', 'select',
  'id = app_user_id() or exists (select 1 from organization_members a join organization_members b on a.organization_id = b.organization_id where a.user_id = app_user_id() and b.user_id = app_users.id) or is_platform_admin()');
select _policy('app_users', 'upd', 'update', 'id = app_user_id()', 'id = app_user_id()');
select _policy('organizations', 'sel', 'select', 'is_member(id) or id = app_driver_org() or is_platform_admin()');
select _policy('organizations', 'upd', 'update', 'can_admin(id)', 'can_admin(id)');
select _policy('organization_members', 'sel', 'select', 'is_member(organization_id) or is_platform_admin()');
select _policy('organization_members', 'ins', 'insert', null, 'can_admin(organization_id) and role <> ''owner''');
select _policy('organization_members', 'upd', 'update', 'can_admin(organization_id)', 'can_admin(organization_id) and (role <> ''owner'' or is_member(organization_id, array[''owner'']::org_role[]))');
select _policy('organization_members', 'del', 'delete', 'can_admin(organization_id)');
select _policy('organization_invites', 'sel', 'select', 'can_admin(organization_id)');
select _policy('organization_invites', 'ins', 'insert', null, 'can_admin(organization_id)');
select _policy('organization_invites', 'upd', 'update', 'can_admin(organization_id)', 'can_admin(organization_id)');
select _policy('organization_invites', 'del', 'delete', 'can_admin(organization_id)');
select _policy('plans', 'sel', 'select', 'true');
select _policy('subscriptions', 'sel', 'select', 'can_admin(organization_id) or is_platform_admin()');
select _policy('usage_counters', 'sel', 'select', 'can_admin(organization_id) or is_platform_admin()');
select _policy('support_grants', 'sel', 'select', 'can_admin(organization_id) or is_platform_admin()');
select _policy('audit_logs', 'sel', 'select', 'can_admin(organization_id) or is_platform_admin()');
select _policy('audit_logs', 'ins', 'insert', null,
  '(actor_type = ''member'' and actor_id = app_user_id() and is_member(organization_id)) or (actor_type = ''driver'' and actor_id = app_driver_id() and organization_id = app_driver_org())');

-- ── Tabelas privadas com padrão uniforme ──
-- leitura: membros; escrita: owner/admin/dispatcher; eliminação: owner/admin.
do $$ declare t text; begin
  foreach t in array array['vehicles','drivers','documents','trips','trip_stops','incidents','delivery_proofs',
                           'trip_routes','trip_route_places','trip_progress','voice_announcements','trip_events','files',
                           'tracking_shares','driver_consents'] loop
    perform _policy(t, 'sel', 'select', 'is_member(organization_id)');
    perform _policy(t, 'ins', 'insert', null, 'can_write(organization_id)');
    perform _policy(t, 'upd', 'update', 'can_write(organization_id)', 'can_write(organization_id)');
    perform _policy(t, 'del', 'delete', 'can_admin(organization_id)');
  end loop;
  -- dispositivos e chaves: só owner/admin escrevem
  foreach t in array array['gps_devices','device_assignments','ingest_keys','alert_rules','notification_channels'] loop
    perform _policy(t, 'sel', 'select', 'is_member(organization_id)');
    perform _policy(t, 'ins', 'insert', null, 'can_admin(organization_id)');
    perform _policy(t, 'upd', 'update', 'can_admin(organization_id)', 'can_admin(organization_id)');
    perform _policy(t, 'del', 'delete', 'can_admin(organization_id)');
  end loop;
  -- custos: o perfil viewer não vê valores
  foreach t in array array['fuel_records','maintenance_schedules','maintenance_records','trip_expenses'] loop
    perform _policy(t, 'sel', 'select', 'can_see_costs(organization_id)');
    perform _policy(t, 'ins', 'insert', null, 'can_write(organization_id)');
    perform _policy(t, 'upd', 'update', 'can_write(organization_id)', 'can_write(organization_id)');
    perform _policy(t, 'del', 'delete', 'can_admin(organization_id)');
  end loop;
end $$;
-- driver_access: leitura por admins (sem colunas de hash), revogação por admins.
select _policy('driver_access', 'sel', 'select', 'can_admin(organization_id)');
select _policy('driver_access', 'upd', 'update', 'can_admin(organization_id)', 'can_admin(organization_id)');
select _policy('ingest_keys', 'sel', 'select', 'can_admin(organization_id)');

-- Telemetria: só leitura (escrita só por ingest_positions).
select _policy('vehicle_positions', 'sel', 'select', 'is_member(organization_id)');
select _policy('vehicle_latest_positions', 'sel', 'select', 'is_member(organization_id)');
select _policy('trip_tracks', 'sel', 'select', 'is_member(organization_id)');
select _policy('tracking_access_logs', 'sel', 'select', 'can_write(organization_id)');

-- Alertas e notificações
select _policy('alerts', 'sel', 'select', 'is_member(organization_id)');
select _policy('alerts', 'upd', 'update', 'can_write(organization_id)', 'can_write(organization_id)');
select _policy('notifications', 'sel', 'select', 'user_id = app_user_id()');
select _policy('notifications', 'upd', 'update', 'user_id = app_user_id()', 'user_id = app_user_id()');
select _policy('push_subscriptions', 'sel', 'select', 'user_id = app_user_id()');
select _policy('push_subscriptions', 'ins', 'insert', null, 'user_id = app_user_id() and is_member(organization_id)');
select _policy('push_subscriptions', 'del', 'delete', 'user_id = app_user_id()');

-- Geografia: dados públicos de leitura; locais privados da organização.
select _policy('geo_datasets', 'sel', 'select', 'true');
select _policy('admin_areas', 'sel', 'select', 'true');
select _policy('places', 'sel', 'select', 'organization_id is null or is_member(organization_id) or organization_id = app_driver_org()');
select _policy('places', 'ins', 'insert', null, 'organization_id is not null and can_write(organization_id)');
select _policy('places', 'upd', 'update', 'organization_id is not null and can_write(organization_id)', 'organization_id is not null and can_write(organization_id)');
select _policy('places', 'del', 'delete', 'organization_id is not null and can_admin(organization_id)');
select _policy('route_cache', 'sel', 'select', 'true');
select _policy('route_cache', 'ins', 'insert', null, 'true');
select _policy('route_cache', 'upd', 'update', 'true', 'true');
select _policy('segment_speed_stats', 'sel', 'select', 'true');
select _policy('segment_speed_stats', 'ins', 'insert', null, 'true');
select _policy('segment_speed_stats', 'upd', 'update', 'true', 'true');

-- ── Motorista (contexto app.driver_id): só as SUAS viagens ──
select _policy('trips', 'drv_sel', 'select', 'driver_id = app_driver_id()');
select _policy('drivers', 'drv_sel', 'select', 'id = app_driver_id()');
select _policy('vehicles', 'drv_sel', 'select', 'exists (select 1 from trips t where t.vehicle_id = vehicles.id and t.driver_id = app_driver_id())');
do $$ declare t text; begin
  foreach t in array array['trip_stops','trip_routes','trip_progress','trip_events','incidents','delivery_proofs','voice_announcements','trip_expenses'] loop
    perform _policy(t, 'drv_sel', 'select', 'driver_owns_trip(trip_id)');
  end loop;
  foreach t in array array['trip_events','incidents','delivery_proofs','voice_announcements','trip_expenses'] loop
    perform _policy(t, 'drv_ins', 'insert', null, 'driver_owns_trip(trip_id) and organization_id = app_driver_org()');
  end loop;
end $$;
select _policy('trip_route_places', 'drv_sel', 'select',
  'exists (select 1 from trip_routes r where r.id = trip_route_places.trip_route_id and driver_owns_trip(r.trip_id))');
select _policy('trip_stops', 'drv_upd', 'update', 'driver_owns_trip(trip_id)', 'driver_owns_trip(trip_id)');
select _policy('files', 'drv_ins', 'insert', null,
  'organization_id = app_driver_org() and created_by = app_driver_id() and kind in (''receipt'',''delivery_photo'',''signature'',''incident_photo'')');
select _policy('files', 'drv_sel', 'select', 'organization_id = app_driver_org() and created_by = app_driver_id()');
select _policy('driver_consents', 'drv_ins', 'insert', null, 'driver_id = app_driver_id() and organization_id = app_driver_org()');
select _policy('driver_consents', 'drv_sel', 'select', 'driver_id = app_driver_id()');

-- ── Viagens: só se criam no estado inicial; o estado muda só por trip_transition ──
create or replace function trips_guard_status() returns trigger language plpgsql as $$
begin
  if current_user = 'app_api' then
    if tg_op = 'INSERT' and new.status <> 'planeada' then
      raise exception 'use_trip_transition' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.status is distinct from old.status or new.actual_departure is distinct from old.actual_departure
                                 or new.actual_arrival is distinct from old.actual_arrival) then
      raise exception 'use_trip_transition' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t_trip_guard on trips;
create trigger t_trip_guard before insert or update on trips for each row execute function trips_guard_status();

-- ── Estado derivado do veículo (SPEC §6.3) — uma só fonte de verdade ──
create or replace view vehicle_status_v with (security_invoker = true) as
select v.id, v.organization_id, v.plate_normalized as plate, v.make, v.model, v.year, v.capacity_t, v.odometer_km, v.admin_status,
  t.id as active_trip_id, t.code as active_trip_code, t.status as active_trip_status,
  lp.device_time as last_position_at, lp.source as last_source, lp.speed_kmh, lp.heading,
  ST_X(lp.geom::geometry) as lng, ST_Y(lp.geom::geometry) as lat,
  exists (select 1 from device_assignments da where da.vehicle_id = v.id and da.valid_to is null) as has_device,
  case
    when lp.device_time is null then 'sem_dados'
    when lp.device_time > now() - make_interval(secs => coalesce((o.settings->>'freshness_current_s')::int, 120)) then 'atual'
    when lp.device_time > now() - make_interval(secs => coalesce((o.settings->>'freshness_stale_s')::int, 900)) then 'desatualizada'
    else 'sem_sinal' end as freshness,
  case
    when v.admin_status = 'em_manutencao' then 'em_manutencao'
    when v.admin_status = 'inativo' then 'inativo'
    when t.id is not null then 'em_viagem'
    else 'disponivel' end as main_status
from vehicles v
join organizations o on o.id = v.organization_id
left join trips t on t.vehicle_id = v.id and t.status in ('em_viagem','pausada') and t.deleted_at is null
left join vehicle_latest_positions lp on lp.vehicle_id = v.id
where v.deleted_at is null;
grant select on vehicle_status_v, fuel_consumption_v to app_api;

-- Futuras tabelas: permissões por omissão (mas RLS tem de ser ativado explicitamente; o teste falha se faltar).
alter default privileges in schema public grant select, insert, update, delete on tables to app_api;
