-- 0013 — Transições com a hora real da ação (fila offline do motorista, lacuna L3/RNF-7).
-- Reversão: drop function trip_transition(uuid, trip_status, text, timestamptz) e repor a versão de 0003.
drop function if exists trip_transition(uuid, trip_status, text);
create or replace function trip_transition(p_trip uuid, p_to trip_status, p_reason text default null, p_at timestamptz default null)
returns trips language plpgsql security definer set search_path = public as $$
declare t trips; actor_type text; actor uuid; allowed boolean := false; is_mgr boolean; is_drv boolean; at_ts timestamptz;
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

  -- Hora real da ação (fila offline do motorista): nunca no futuro, no máximo 24 h atrás, nunca antes da criação.
  at_ts := least(now(), greatest(coalesce(p_at, now()), now() - interval '24 hours', t.created_at));
  if p_to = 'concluida' and t.actual_departure is not null then at_ts := greatest(at_ts, t.actual_departure); end if;
  update trips set status = p_to,
    actual_departure = case when p_to = 'em_viagem' and actual_departure is null then at_ts else actual_departure end,
    actual_arrival = case when p_to = 'concluida' then at_ts else actual_arrival end,
    cancel_reason = case when p_to = 'cancelada' then p_reason else cancel_reason end
  where id = p_trip returning * into t;

  insert into trip_events (organization_id, trip_id, kind, actor_type, actor_id, payload, occurred_at)
  values (t.organization_id, t.id,
    case p_to when 'em_viagem' then (case when t.actual_departure = at_ts then 'partida' else 'retomada' end)
              when 'pausada' then 'pausa' when 'concluida' then 'chegada' when 'cancelada' then 'cancelamento'
              else 'estado' end,
    actor_type, actor, jsonb_build_object('para', p_to, 'motivo', p_reason), at_ts);
  insert into audit_logs (organization_id, actor_type, actor_id, action, entity, entity_id, after)
  values (t.organization_id, actor_type, actor, 'viagem.estado', 'trips', t.id, jsonb_build_object('status', p_to));
  return t;
end $$;

