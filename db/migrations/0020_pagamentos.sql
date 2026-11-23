-- 0020 — Pagamento por viagem: a 1.ª viagem real de cada organização é grátis; as seguintes pagam (250 MT por omissão)
-- por M-Pesa / e-Mola. O cliente envia o código da transação e a fotografia do comprovativo (lida no telemóvel).
-- Confirmação: automática quando o mesmo código (ou o número de quem pagou + o valor) chega num SMS reencaminhado do telemóvel do proprietário
-- (o SMS só existe se o dinheiro entrou), senão manual pela plataforma. Uma fotografia sozinha NUNCA aprova.
-- O bloqueio está na BD (gatilho em trips): não se inicia uma viagem por fora do checkout.
-- Reversão: drop trigger trips_payment_gate on trips; drop function trip_can_start(trips), trips_payment_gate(),
--   payment_decide(uuid, boolean, text), payment_match_sms(uuid), payment_autostart(uuid); drop table payment_sms, trip_payments, billing_settings;
--   alter table organizations drop column payments_blocked.

create table billing_settings (
  id boolean primary key default true check (id),          -- uma só linha
  price_per_trip numeric(14,2) not null default 250 check (price_per_trip >= 0),
  currency char(3) not null default 'MZN',
  free_trips int not null default 1 check (free_trips >= 0),
  mpesa_number text, mpesa_name text,
  emola_number text, emola_name text,
  updated_at timestamptz not null default now()
);
insert into billing_settings default values;

alter table organizations add column payments_blocked boolean not null default false;

create table trip_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'MZN',
  method text not null check (method in ('mpesa','emola')),
  transaction_id text not null check (transaction_id ~ '^[A-Z0-9]{6,20}$'),
  payer_phone text,
  receipt_file_id uuid references files(id) on delete set null,
  ocr_text text, ocr_amount numeric(14,2), ocr_recipient text, ocr_date text,
  status text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado')),
  auto boolean not null default false,
  sms_id uuid,
  decided_by uuid, decided_at timestamptz, reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- cada código de transação só serve UMA vez em todo o sistema (exceto se foi rejeitado)
create unique index trip_payments_tx_uq on trip_payments (transaction_id) where status <> 'rejeitado';
create index on trip_payments (organization_id, created_at desc);
create index on trip_payments (trip_id);

-- SMS de pagamento reencaminhados do telemóvel do proprietário (só a plataforma vê)
create table payment_sms (
  id uuid primary key default gen_random_uuid(),
  raw text not null,
  sender text,
  transaction_id text,
  amount numeric(14,2),
  payer text,
  method text,
  received_at timestamptz not null default now(),
  matched_payment_id uuid references trip_payments(id) on delete set null
);
create unique index payment_sms_tx_uq on payment_sms (transaction_id) where transaction_id is not null;

alter table billing_settings enable row level security;
alter table trip_payments enable row level security;
alter table payment_sms enable row level security;
-- preço e números: todos os membros autenticados leem (o checkout mostra-os); só a plataforma altera (via função)
select _policy('billing_settings', 'sel', 'select', 'app_user_id() is not null');
select _policy('trip_payments', 'sel', 'select', 'can_write(organization_id) or is_platform_admin()');
select _policy('trip_payments', 'ins', 'insert', null, 'can_write(organization_id) and status = ''pendente'' and not auto');
select _policy('payment_sms', 'sel', 'select', 'is_platform_admin()');
revoke update, delete on trip_payments from app_api;
revoke insert, update, delete on billing_settings, payment_sms from app_api;

/** A viagem pode começar? Teste do telemóvel, viagens grátis restantes ou pagamento aprovado para esta viagem. */
create or replace function trip_can_start(t trips) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b billing_settings; used int; blocked boolean;
begin
  if exists (select 1 from vehicles v where v.id = t.vehicle_id and v.is_test) then return true; end if;
  -- a empresa do próprio dono da plataforma não paga a si mesma
  if exists (select 1 from organization_members om join app_users u on u.id = om.user_id where om.organization_id = t.organization_id and u.is_platform_admin) then return true; end if;
  if exists (select 1 from trip_payments p where p.trip_id = t.id and p.status = 'aprovado') then return true; end if;
  select * into b from billing_settings limit 1;
  select payments_blocked into blocked from organizations where id = t.organization_id;
  -- viagens reais já iniciadas (mesmo apagadas: apagar não devolve a viagem grátis)
  select count(*) into used from trips x left join vehicles v on v.id = x.vehicle_id
   where x.organization_id = t.organization_id and x.id <> t.id and x.actual_departure is not null and not coalesce(v.is_test, false);
  return not coalesce(blocked, false) and used < coalesce(b.free_trips, 1);
end $$;

create or replace function trips_payment_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'em_viagem' and new.actual_departure is not null
     and (tg_op = 'INSERT' or old.actual_departure is null) and not trip_can_start(new) then
    raise exception 'pagamento_necessario' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trips_payment_gate before insert or update of status, actual_departure on trips
  for each row execute function trips_payment_gate();

/** Pagamento aprovado → a viagem começa sozinha (se ainda estiver por iniciar e tiver camião e motorista).
 * Se o camião/motorista estiver noutra viagem em curso, fica por iniciar (o cliente inicia quando quiser). */
create or replace function payment_autostart(p_trip uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t trips;
begin
  select * into t from trips where id = p_trip and deleted_at is null for update;
  if t.id is null or t.status not in ('planeada','aguardando_partida') or t.vehicle_id is null or t.driver_id is null then return; end if;
  begin
    update trips set status = 'em_viagem', actual_departure = coalesce(actual_departure, now()) where id = t.id;
    insert into trip_events (organization_id, trip_id, kind, actor_type, payload)
    values (t.organization_id, t.id, 'partida', 'system', jsonb_build_object('para', 'em_viagem', 'motivo', 'pagamento confirmado'));
  exception when unique_violation then null; -- camião/motorista ocupado: fica por iniciar
  end;
end $$;

/** Aprovar/rejeitar (plataforma). 3 rejeições bloqueiam a organização até a plataforma desbloquear. */
create or replace function payment_decide(p_id uuid, p_approve boolean, p_reason text) returns trip_payments
language plpgsql security definer set search_path = public as $$
declare p trip_payments;
begin
  if not is_platform_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  update trip_payments set status = case when p_approve then 'aprovado' else 'rejeitado' end, decided_by = app_user_id(),
    decided_at = now(), reason = p_reason, updated_at = now()
  where id = p_id and status = 'pendente' returning * into p;
  if p.id is null then raise exception 'pagamento_inexistente' using errcode = 'P0002'; end if;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
  values (p.organization_id, 'platform', app_user_id(), case when p_approve then 'pagamento.aprovar' else 'pagamento.rejeitar' end,
    'trip_payments', p.id, jsonb_build_object('motivo', p_reason, 'valor', p.amount, 'codigo', p.transaction_id));
  if not p_approve and (select count(*) from trip_payments where organization_id = p.organization_id and status = 'rejeitado') >= 3 then
    update organizations set payments_blocked = true where id = p.organization_id;
  end if;
  if p_approve then perform payment_autostart(p.trip_id); end if;
  return p;
end $$;

/** Liga um pagamento pendente a um SMS recebido com o MESMO código e valor suficiente → aprovado sozinho. */
create or replace function payment_match_sms(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare p trip_payments; s payment_sms;
begin
  select * into p from trip_payments where id = p_id and status = 'pendente' for update;
  if p.id is null then return false; end if;
  -- 1) o MESMO código da transação; 2) senão, o número de quem pagou + o valor, num SMS das últimas 24 h
  select * into s from payment_sms where transaction_id = p.transaction_id and matched_payment_id is null
    and amount >= p.amount and received_at > now() - interval '7 days' limit 1;
  if s.id is null and p.payer_phone is not null then
    select * into s from payment_sms where payer = p.payer_phone and matched_payment_id is null
      and amount >= p.amount and received_at > now() - interval '24 hours' order by received_at desc limit 1;
  end if;
  if s.id is null then return false; end if;
  update trip_payments set status = 'aprovado', auto = true, sms_id = s.id, decided_at = now(), updated_at = now() where id = p.id;
  update payment_sms set matched_payment_id = p.id where id = s.id;
  insert into audit_logs (organization_id, actor_type, action, entity, entity_id, after)
  values (p.organization_id, 'system', 'pagamento.aprovar_sms', 'trip_payments', p.id, jsonb_build_object('codigo', p.transaction_id, 'valor', s.amount));
  perform payment_autostart(p.trip_id);
  return true;
end $$;
