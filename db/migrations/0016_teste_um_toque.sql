-- 0016 — "Testar com o meu telemóvel" com um toque: o motorista ligado ao próprio utilizador (o dono a testar)
-- não precisa de número de telefone. Motoristas normais continuam a exigir telefone.
-- Reversão: preencher os telefones em falta e repor "alter table drivers alter column phone set not null".
alter table drivers alter column phone drop not null;
alter table drivers add constraint drivers_phone_required check (phone is not null or user_id is not null);
