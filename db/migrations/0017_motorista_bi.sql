-- 0017 — Número do BI do motorista (Bilhete de Identidade de Moçambique: 12 algarismos + 1 letra).
-- Opcional na BD (motoristas antigos e "Eu próprio" continuam válidos); o formulário exige-o nos novos.
-- Único por organização (a mesma pessoa pode trabalhar para duas empresas diferentes).
-- A tabela drivers já tem RLS por organização: a coluna nova fica coberta pelas mesmas políticas.
-- Reversão: drop index if exists drivers_id_number_uq; alter table drivers drop column if exists id_number;
alter table drivers add column if not exists id_number text
  check (id_number is null or id_number ~ '^[0-9]{12}[A-Z]$');
create unique index if not exists drivers_id_number_uq on drivers (organization_id, id_number)
  where id_number is not null and deleted_at is null;
