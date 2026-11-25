-- 0021 — Pagamento sem SMS: o comprovativo é analisado por IA (visão) + verificações duras no servidor (ADR-030).
-- Aprovado sozinho só se tudo bater certo e a IA não vir sinais de edição; dúvidas → "em análise" (o proprietário decide);
-- o proprietário pode ANULAR um pagamento aprovado (era burla): a viagem é cancelada e a empresa fica bloqueada.
-- Reversão: drop function payment_ai_decide(uuid, text, text, jsonb, int), payment_revoke(uuid, text);
--   drop index trip_payments_img_uq; alter table trip_payments drop column ai_result, drop column ai_risk, drop column image_sha256,
--   drop column image_dhash, drop column decided_by_ai; repor o check de status sem 'anulado' (depois de mudar os 'anulado' para 'rejeitado').

alter table trip_payments drop constraint if exists trip_payments_status_check;
alter table trip_payments add constraint trip_payments_status_check check (status in ('pendente','aprovado','rejeitado','anulado'));
alter table trip_payments add column ai_result jsonb, add column ai_risk int, add column image_sha256 text, add column image_dhash text,
  add column decided_by_ai boolean not null default false;
-- a mesma imagem (byte a byte) só serve para UM pagamento em todo o sistema
create unique index trip_payments_img_uq on trip_payments (image_sha256) where image_sha256 is not null and status <> 'rejeitado';

/** Decisão do sistema depois da análise (só o servidor, ligação de sistema). Aprovado → a viagem começa sozinha.
 *  5 rejeições em 24 h bloqueiam a empresa (alguém a tentar comprovativos falsos). */
create or replace function payment_ai_decide(p_id uuid, p_status text, p_reason text, p_ai jsonb, p_risk int) returns trip_payments
language plpgsql security definer set search_path = public as $$
declare p trip_payments;
begin
  if p_status not in ('pendente','aprovado','rejeitado') then raise exception 'estado_invalido' using errcode = 'P0001'; end if;
  update trip_payments set status = p_status, reason = p_reason, ai_result = p_ai, ai_risk = p_risk,
    decided_by_ai = (p_status <> 'pendente'), auto = (p_status = 'aprovado'),
    decided_at = case when p_status <> 'pendente' then now() end, updated_at = now()
  where id = p_id and status = 'pendente' returning * into p;
  if p.id is null then raise exception 'pagamento_inexistente' using errcode = 'P0002'; end if;
  if p_status <> 'pendente' then
    insert into audit_logs (organization_id, actor_type, action, entity, entity_id, after)
    values (p.organization_id, 'system', case p_status when 'aprovado' then 'pagamento.aprovar_ia' else 'pagamento.rejeitar_ia' end,
      'trip_payments', p.id, jsonb_build_object('codigo', p.transaction_id, 'risco', p_risk, 'motivo', p_reason));
  end if;
  if p_status = 'rejeitado' and (select count(*) from trip_payments where organization_id = p.organization_id
      and status = 'rejeitado' and created_at > now() - interval '24 hours') >= 5 then
    update organizations set payments_blocked = true where id = p.organization_id;
  end if;
  if p_status = 'aprovado' then perform payment_autostart(p.trip_id); end if;
  return p;
end $$;
revoke all on function payment_ai_decide(uuid, text, text, jsonb, int) from public;

/** "Era burla" (plataforma): anula um pagamento aprovado, cancela a viagem (o cliente deixa de a seguir) e bloqueia a empresa. */
create or replace function payment_revoke(p_id uuid, p_reason text) returns trip_payments
language plpgsql security definer set search_path = public as $$
declare p trip_payments; t trips;
begin
  if not is_platform_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'motivo_obrigatorio' using errcode = 'P0001'; end if;
  update trip_payments set status = 'anulado', reason = p_reason, decided_by = app_user_id(), decided_at = now(), updated_at = now()
  where id = p_id and status = 'aprovado' returning * into p;
  if p.id is null then raise exception 'pagamento_inexistente' using errcode = 'P0002'; end if;
  update organizations set payments_blocked = true where id = p.organization_id;
  select * into t from trips where id = p.trip_id and deleted_at is null for update;
  if t.id is not null and t.status not in ('concluida','cancelada') then
    update trips set status = 'cancelada', cancel_reason = 'Pagamento anulado: ' || p_reason where id = t.id;
    insert into trip_events (organization_id, trip_id, kind, actor_type, payload)
    values (t.organization_id, t.id, 'cancelamento', 'system', jsonb_build_object('para', 'cancelada', 'motivo', 'pagamento anulado'));
  end if;
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
  values (p.organization_id, 'platform', app_user_id(), 'pagamento.anular', 'trip_payments', p.id,
    jsonb_build_object('motivo', p_reason, 'codigo', p.transaction_id, 'valor', p.amount));
  return p;
end $$;
