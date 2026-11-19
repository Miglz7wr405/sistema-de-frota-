-- 0011 — Recálculo após desvio: a nova rota começa na posição atual; base_km guarda os km já feitos
-- para que o progresso total continue correto. Reversão: alter table trip_routes drop column base_km.
alter table trip_routes add column base_km double precision not null default 0 check (base_km >= 0);
