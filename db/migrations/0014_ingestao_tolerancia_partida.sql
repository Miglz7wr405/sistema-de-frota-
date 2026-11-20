-- 0014 — A 1.ª posição do telemóvel pode ter hora ligeiramente anterior ao "Iniciar viagem"
-- (o navegador entrega a última posição em cache). Tolerância de 2 min na associação à viagem.
-- Reversão: repor a função de 0005_telemetria.sql.
create or replace function ingest_positions(p_org uuid, p_vehicle uuid, p_source text, p_source_id text, p_points jsonb)
returns table (id uuid, device_time timestamptz, trip_id uuid, lng double precision, lat double precision,
               speed_kmh real, heading real, accuracy_m real, flags text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare pt jsonb; dt timestamptz; t uuid; new_id uuid; prio text; cur vehicle_latest_positions; take boolean;
begin
  if not exists (select 1 from vehicles v where v.id = p_vehicle and v.organization_id = p_org and v.deleted_at is null) then
    raise exception 'veiculo_invalido' using errcode = '42501';
  end if;
  select gps_source_priority into prio from vehicles where vehicles.id = p_vehicle;

  for pt in select * from jsonb_array_elements(p_points) order by (value->>'device_time')::timestamptz loop
    dt := (pt->>'device_time')::timestamptz;
    select tr.id into t from trips tr
     where tr.vehicle_id = p_vehicle and tr.deleted_at is null and tr.status <> 'cancelada'
       and tr.actual_departure is not null and tr.actual_departure - interval '2 minutes' <= dt
       and (tr.actual_arrival is null or tr.actual_arrival >= dt)
     order by tr.actual_departure desc limit 1;

    insert into vehicle_positions (organization_id, vehicle_id, trip_id, source, source_id, device_time, sent_at,
                                   geom, speed_kmh, heading, accuracy_m, battery_pct, ignition, flags)
    values (p_org, p_vehicle, t, p_source, p_source_id, dt, (pt->>'sent_at')::timestamptz,
            ST_SetSRID(ST_MakePoint((pt->>'lng')::float8, (pt->>'lat')::float8), 4326)::geography,
            (pt->>'speed_kmh')::real, (pt->>'heading')::real, (pt->>'accuracy_m')::real,
            (pt->>'battery_pct')::smallint, (pt->>'ignition')::boolean,
            coalesce(array(select jsonb_array_elements_text(pt->'flags')), '{}'))
    on conflict on constraint vehicle_positions_source_id_device_time_key do nothing
    returning vehicle_positions.id into new_id;

    if new_id is null then continue; end if; -- duplicado

    select * into cur from vehicle_latest_positions where vehicle_latest_positions.vehicle_id = p_vehicle for update;
    take := cur.vehicle_id is null
         or (dt > cur.device_time and (
               cur.source_id = p_source_id
               or (case when p_source = 'device' then 'device' else 'phone' end) = prio
               or cur.device_time < now() - interval '2 minutes'));
    if take then
      insert into vehicle_latest_positions (vehicle_id, organization_id, trip_id, source, source_id, device_time, received_at,
                                            geom, speed_kmh, heading, accuracy_m, battery_pct)
      values (p_vehicle, p_org, t, p_source, p_source_id, dt, now(),
              ST_SetSRID(ST_MakePoint((pt->>'lng')::float8, (pt->>'lat')::float8), 4326)::geography,
              (pt->>'speed_kmh')::real, (pt->>'heading')::real, (pt->>'accuracy_m')::real, (pt->>'battery_pct')::smallint)
      on conflict (vehicle_id) do update set trip_id = excluded.trip_id, source = excluded.source, source_id = excluded.source_id,
        device_time = excluded.device_time, received_at = excluded.received_at, geom = excluded.geom,
        speed_kmh = excluded.speed_kmh, heading = excluded.heading, accuracy_m = excluded.accuracy_m,
        battery_pct = excluded.battery_pct, updated_at = now();
    end if;

    return query select new_id, dt, t, (pt->>'lng')::float8, (pt->>'lat')::float8, (pt->>'speed_kmh')::real,
      (pt->>'heading')::real, (pt->>'accuracy_m')::real, coalesce(array(select jsonb_array_elements_text(pt->'flags')), '{}');
  end loop;

  insert into usage_counters (organization_id, period, positions_ingested)
    values (p_org, date_trunc('month', now())::date, jsonb_array_length(p_points))
  on conflict (organization_id, period) do update set positions_ingested = usage_counters.positions_ingested + excluded.positions_ingested;
end $$;

