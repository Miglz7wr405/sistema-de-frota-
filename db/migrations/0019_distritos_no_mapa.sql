-- 0019 — Distritos no mapa: limites (simplificados, ~1 km) e ponto para o nome de cada distrito atravessado pela rota.
-- Dados geográficos públicos (geoBoundaries ADM2, CC BY 4.0); nada da organização além da rota já partilhada.
-- Reversão: drop function route_areas(uuid).
create or replace function route_areas(p_route uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', a.name, 'province', pv.name,
      'boundary', ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Boundary(a.geom::geometry), 0.01), 3)::jsonb,
      'label', jsonb_build_array(round(ST_X(ST_PointOnSurface(a.geom::geometry))::numeric, 4), round(ST_Y(ST_PointOnSurface(a.geom::geometry))::numeric, 4)))
    order by a.name), '[]'::jsonb)
  from admin_areas a left join admin_areas pv on pv.id = a.parent_id
  where a.level = 2 and a.code in (select code from route_districts(p_route))
$$;
