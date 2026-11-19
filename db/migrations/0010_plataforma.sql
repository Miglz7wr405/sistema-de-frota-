-- 0010 — Funções privilegiadas controladas: emissão de acessos de motorista e chaves de ingestão,
-- partilhas, administração da plataforma (planos, suporte auditado).
-- Reversão: 0010_plataforma.down.sql.

create or replace function driver_access_issue(p_driver uuid, p_token_hash text, p_pin_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare org uuid; a uuid;
begin
  select organization_id into org from drivers where id = p_driver and deleted_at is null;
  if org is null or not can_admin(org) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  update driver_access set revoked_at = now() where driver_id = p_driver and revoked_at is null;
  update driver_sessions set revoked_at = now() where driver_id = p_driver and revoked_at is null;
  insert into driver_access (organization_id, driver_id, token_hash, pin_hash, created_by)
    values (org, p_driver, p_token_hash, p_pin_hash, app_user_id()) returning id into a;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (org, 'member', app_user_id(), 'motorista.acesso_emitido', 'drivers', p_driver);
  return a;
end $$;

create or replace function driver_access_revoke(p_driver uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from drivers where id = p_driver;
  if org is null or not can_admin(org) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  update driver_access set revoked_at = now() where driver_id = p_driver and revoked_at is null;
  update driver_sessions set revoked_at = now() where driver_id = p_driver and revoked_at is null;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (org, 'member', app_user_id(), 'motorista.acesso_revogado', 'drivers', p_driver);
end $$;

create or replace function ingest_key_issue(p_org uuid, p_name text, p_scope text, p_key_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if not can_admin(p_org) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  insert into ingest_keys (organization_id, name, scope, key_hash) values (p_org, p_name, p_scope, p_key_hash) returning id into k;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (p_org, 'member', app_user_id(), 'chave_ingestao.criar', 'ingest_keys', k);
  return k;
end $$;

-- Partilhas: criar (limite do plano + auditoria), revogar.
create or replace function share_create(p_trip uuid, p_stop uuid, p_token_hash text, p_expires timestamptz, p_options jsonb)
returns tracking_shares language plpgsql security definer set search_path = public as $$
declare t trips; s tracking_shares; lim int; cnt int; code text; tries int := 0;
begin
  select * into t from trips where id = p_trip and deleted_at is null;
  if t.id is null or not can_write(t.organization_id) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  lim := plan_limit(t.organization_id, 'max_active_shares');
  select count(*) into cnt from tracking_shares where organization_id = t.organization_id and is_active and revoked_at is null and expires_at > now();
  if lim is not null and cnt >= lim then raise exception 'limite_plano:max_active_shares' using errcode = 'P0001'; end if;
  loop
    code := gen_ft_code(); tries := tries + 1;
    exit when not exists (select 1 from tracking_shares where short_code = code) or tries > 5;
  end loop;
  insert into tracking_shares (organization_id, trip_id, stop_id, short_code, token_hash, expires_at, options, created_by)
  values (t.organization_id, t.id, p_stop, code, p_token_hash, p_expires,
          coalesce(p_options, '{"show_company":true,"show_logo":true,"show_plate_masked":false,"show_driver_first_name":false}'::jsonb), app_user_id())
  returning * into s;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (t.organization_id, 'member', app_user_id(), 'partilha.criar', 'tracking_shares', s.id);
  return s;
end $$;

create or replace function share_revoke(p_share uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from tracking_shares where id = p_share;
  if org is null or not can_write(org) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  update tracking_shares set revoked_at = now(), is_active = false where id = p_share;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id)
    values (org, 'member', app_user_id(), 'partilha.revogar', 'tracking_shares', p_share);
end $$;

-- Plataforma (admin Insight)
create or replace function platform_overview() returns table (
  id uuid, name text, created_at timestamptz, plan_code text, sub_status text, members int, vehicles int, trips_30d int,
  positions_month bigint, public_views_month bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return query
  select o.id, o.name, o.created_at, p.code, s.status,
    (select count(*)::int from organization_members m where m.organization_id = o.id),
    (select count(*)::int from vehicles v where v.organization_id = o.id and v.deleted_at is null),
    (select count(*)::int from trips t where t.organization_id = o.id and t.created_at > now() - interval '30 days'),
    coalesce(u.positions_ingested, 0), coalesce(u.public_views, 0)
  from organizations o
  left join subscriptions s on s.organization_id = o.id and s.status <> 'canceled'
  left join plans p on p.id = s.plan_id
  left join usage_counters u on u.organization_id = o.id and u.period = date_trunc('month', now())::date
  where o.deleted_at is null order by o.created_at desc;
end $$;

create or replace function platform_set_plan(p_org uuid, p_plan_code text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare pl uuid;
begin
  if not is_platform_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  select id into pl from plans where code = p_plan_code;
  if pl is null then raise exception 'plano_inexistente' using errcode = 'P0002'; end if;
  update subscriptions set plan_id = pl, status = p_status where organization_id = p_org and status <> 'canceled';
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
    values (p_org, 'platform', app_user_id(), 'plataforma.plano', 'subscriptions', p_org, jsonb_build_object('plan', p_plan_code, 'status', p_status));
end $$;

create or replace function platform_grant_support(p_org uuid, p_reason text, p_hours int) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if not is_platform_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if p_hours < 1 or p_hours > 2 then raise exception 'duracao_invalida' using errcode = 'P0001'; end if;
  insert into support_grants (organization_id, user_id, reason, expires_at)
    values (p_org, app_user_id(), p_reason, now() + make_interval(hours => p_hours)) returning id into g;
  -- Visível ao dono: fica na auditoria da organização e gera notificação.
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
    values (p_org, 'platform', app_user_id(), 'plataforma.acesso_suporte', 'support_grants', g, jsonb_build_object('motivo', p_reason, 'horas', p_hours));
  insert into notifications (organization_id, user_id, channel, title, body)
    select p_org, m.user_id, 'in_app', 'Acesso de suporte concedido', 'A equipa insightFrota tem acesso de leitura por ' || p_hours || ' h. Motivo: ' || p_reason
    from organization_members m where m.organization_id = p_org and m.role = 'owner';
  return g;
end $$;
