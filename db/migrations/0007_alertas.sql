-- 0007 — Alertas e notificações: regras, alertas (aberto/reconhecido/resolvido), canais, push web, jobs.
-- Reversão: 0007_alertas.down.sql.

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('inicio_viagem','chegada','chegada_ponto','sem_sinal','atraso','desvio','paragem_anormal',
                                      'manutencao_proxima','documento_expirar','dispositivo_problema')),
  enabled boolean not null default true,
  severity text not null default 'media' check (severity in ('baixa','media','alta')),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind)
);
create trigger t_ar_upd before update on alert_rules for each row execute function set_updated_at();

create table alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  severity text not null default 'media',
  status text not null default 'aberto' check (status in ('aberto','reconhecido','resolvido')),
  dedup_key text not null,
  title text not null,
  detail text,
  vehicle_id uuid references vehicles(id) on delete cascade,
  trip_id uuid references trips(id) on delete cascade,
  driver_id uuid references drivers(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index alerts_one_open on alerts (organization_id, dedup_key) where status <> 'resolvido';
create index on alerts (organization_id, status, opened_at desc);
create trigger t_al_upd before update on alerts for each row execute function set_updated_at();

create table notification_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('in_app','web_push','email','sms','whatsapp')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  alert_id uuid references alerts(id) on delete cascade,
  channel text not null default 'in_app',
  title text not null,
  body text,
  sent_at timestamptz,
  read_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);

-- Regras por omissão para cada organização nova.
create or replace function seed_org_defaults() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into alert_rules (organization_id, kind, severity, params) values
    (new.id, 'inicio_viagem', 'baixa', '{}'), (new.id, 'chegada', 'baixa', '{}'), (new.id, 'chegada_ponto', 'baixa', '{}'),
    (new.id, 'sem_sinal', 'alta', '{"minutes":15}'), (new.id, 'atraso', 'media', '{"tolerance_min":30}'),
    (new.id, 'desvio', 'alta', '{"corridor_m":500,"points":3,"min_minutes":3,"max_accuracy_m":100}'),
    (new.id, 'paragem_anormal', 'media', '{"minutes":30,"radius_m":150,"max_speed_kmh":3}'),
    (new.id, 'manutencao_proxima', 'media', '{"days":7,"km":500}'),
    (new.id, 'documento_expirar', 'media', '{"days":[30,15,7]}'),
    (new.id, 'dispositivo_problema', 'media', '{"hours":24}')
  on conflict do nothing;
  insert into notification_channels (organization_id, kind, enabled) values
    (new.id, 'in_app', true), (new.id, 'web_push', true), (new.id, 'email', false), (new.id, 'sms', false), (new.id, 'whatsapp', false)
  on conflict do nothing;
  return new;
end $$;
create trigger t_org_seed after insert on organizations for each row execute function seed_org_defaults();

-- Abre um alerta se a regra estiver ativa e não houver um igual por resolver. Cria notificações na app.
create or replace function open_alert(p_org uuid, p_kind text, p_dedup text, p_title text, p_detail text,
  p_vehicle uuid default null, p_trip uuid default null, p_driver uuid default null, p_document uuid default null,
  p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rule alert_rules; a uuid;
begin
  select * into rule from alert_rules where organization_id = p_org and kind = p_kind;
  if rule.id is not null and not rule.enabled then return null; end if;
  insert into alerts (organization_id, kind, severity, dedup_key, title, detail, vehicle_id, trip_id, driver_id, document_id, payload)
  values (p_org, p_kind, coalesce(rule.severity, 'media'), p_dedup, p_title, p_detail, p_vehicle, p_trip, p_driver, p_document, p_payload)
  on conflict (organization_id, dedup_key) where status <> 'resolvido' do nothing
  returning id into a;
  if a is not null then
    insert into notifications (organization_id, user_id, alert_id, channel, title, body)
    select p_org, m.user_id, a, 'in_app', p_title, p_detail from organization_members m
    where m.organization_id = p_org and m.role in ('owner','admin','dispatcher');
  end if;
  return a;
end $$;

create or replace function resolve_alert_by_key(p_org uuid, p_dedup text) returns void
language sql security definer set search_path = public as $$
  update alerts set status = 'resolvido', resolved_at = now()
  where organization_id = p_org and dedup_key = p_dedup and status <> 'resolvido'
$$;

-- Job periódico (chamado pela Neon Function "jobs" via trigger de agenda, ADR-018).
create or replace function run_periodic_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n_sinal int := 0; n_docs int := 0; n_manut int := 0; n_dev int := 0; mins int; d int;
begin
  perform ensure_position_partitions(0, 2);

  -- Sem sinal: viagem ativa cuja última posição tem mais de N minutos (um alerta por episódio).
  for r in
    select t.id trip_id, t.organization_id, t.vehicle_id, v.plate_normalized plate, lp.device_time,
           coalesce((ar.params->>'minutes')::int, 15) lim
    from trips t join vehicles v on v.id = t.vehicle_id
    left join vehicle_latest_positions lp on lp.vehicle_id = t.vehicle_id
    left join alert_rules ar on ar.organization_id = t.organization_id and ar.kind = 'sem_sinal'
    where t.status = 'em_viagem' and t.deleted_at is null
  loop
    if r.device_time is null or r.device_time < now() - make_interval(mins => r.lim) then
      if open_alert(r.organization_id, 'sem_sinal', 'sem_sinal:' || r.trip_id,
           r.plate || ' sem comunicação GPS',
           case when r.device_time is null then 'Ainda não houve nenhuma posição nesta viagem.'
                else 'Última posição há ' || floor(extract(epoch from now() - r.device_time) / 60) || ' min.' end,
           r.vehicle_id, r.trip_id) is not null then n_sinal := n_sinal + 1; end if;
    else
      perform resolve_alert_by_key(r.organization_id, 'sem_sinal:' || r.trip_id);
    end if;
  end loop;

  -- Documentos a expirar (30/15/7 dias, configurável) e expirados.
  for r in
    select doc.*, coalesce(v.plate_normalized, dr.full_name) owner_label, ar.params
    from documents doc left join vehicles v on v.id = doc.vehicle_id left join drivers dr on dr.id = doc.driver_id
    left join alert_rules ar on ar.organization_id = doc.organization_id and ar.kind = 'documento_expirar'
    where doc.expires_on is not null and doc.expires_on <= current_date + 30
      and coalesce(v.deleted_at, dr.deleted_at) is null
  loop
    d := doc_days_left(r.expires_on);
    if d < 0 or exists (select 1 from jsonb_array_elements_text(coalesce(r.params->'days', '[30,15,7]')) x where x::int >= d) then
      if open_alert(r.organization_id, 'documento_expirar',
           'doc:' || r.id || ':' || case when d < 0 then 'expirado' when d <= 7 then '7' when d <= 15 then '15' else '30' end,
           case when d < 0 then 'Documento expirado: ' else 'Documento a expirar: ' end || r.owner_label,
           replace(r.doc_type, '_', ' ') || coalesce(' n.º ' || r.number, '') || ' · validade ' || to_char(r.expires_on, 'DD/MM/YYYY'),
           r.vehicle_id, null, r.driver_id, r.id) is not null then n_docs := n_docs + 1; end if;
    end if;
  end loop;

  -- Manutenção próxima (por data ou por km).
  for r in
    select s.*, v.plate_normalized plate, v.odometer_km, ar.params from maintenance_schedules s
    join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
    left join alert_rules ar on ar.organization_id = s.organization_id and ar.kind = 'manutencao_proxima'
  loop
    if (r.next_due_at is not null and r.next_due_at <= current_date + coalesce((r.params->>'days')::int, 7))
       or (r.next_due_km is not null and r.odometer_km is not null and r.odometer_km >= r.next_due_km - coalesce((r.params->>'km')::int, 500)) then
      if open_alert(r.organization_id, 'manutencao_proxima', 'manut:' || r.id || ':' || coalesce(r.next_due_at::text, '') || ':' || coalesce(r.next_due_km::text, ''),
           'Manutenção próxima: ' || r.plate, r.kind, r.vehicle_id) is not null then n_manut := n_manut + 1; end if;
    end if;
  end loop;

  -- Dispositivo sem contacto há mais de N horas.
  for r in
    select g.*, coalesce((ar.params->>'hours')::int, 24) lim from gps_devices g
    left join alert_rules ar on ar.organization_id = g.organization_id and ar.kind = 'dispositivo_problema'
    where g.deleted_at is null and g.status = 'ativo' and g.last_contact_at is not null
  loop
    if r.last_contact_at < now() - make_interval(hours => r.lim) then
      if open_alert(r.organization_id, 'dispositivo_problema', 'dev:' || r.id, 'Dispositivo GPS sem contacto (IMEI ' || r.imei || ')',
           'Último contacto: ' || to_char(r.last_contact_at at time zone 'Africa/Maputo', 'DD/MM HH24:MI')) is not null then n_dev := n_dev + 1; end if;
    else
      perform resolve_alert_by_key(r.organization_id, 'dev:' || r.id);
    end if;
  end loop;

  delete from rate_limits where window_start < now() - interval '1 day';
  delete from ingest_rejections where received_at < now() - interval '30 days';
  delete from tracking_access_logs where accessed_at < now() - interval '90 days';
  get diagnostics mins = row_count;

  return jsonb_build_object('sem_sinal', n_sinal, 'documentos', n_docs, 'manutencao', n_manut, 'dispositivos', n_dev,
                            'ran_at', now());
end $$;

create or replace function run_daily_jobs() returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  n := apply_position_retention();
  return jsonb_build_object('positions_deleted', n, 'ran_at', now());
end $$;

create or replace function doc_days_left(p date) returns int language sql stable as
$$ select (p - (now() at time zone 'Africa/Maputo')::date) $$;
