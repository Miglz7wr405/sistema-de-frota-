# Relatórios de fase — Fases 1 a 11

> Construídas de seguida, com autorização explícita do proprietário ("desenvolve tudo, da fase 1 até ao fim").
> Níveis usados: **IMPLEMENTADO** (código escrito, compila) · **TESTADO** (testes automáticos a passar ou simulador) · **VALIDADO (real)** (aparelho/equipamento real).
> **Nada está VALIDADO (real)**: não houve telemóvel nem equipamento GPS real nesta sessão.

## Estado geral
- Produção: https://insightfrota.vercel.app (Vercel Hobby) · BD Neon `insightfrota` (Frankfurt) com as 13 migrações aplicadas; 57 tabelas, todas com RLS (verificado no Neon).
- Base geográfica real (OpenStreetMap, ODbL) importada a partir da Vercel: **1573 localidades** (22 cidades, 326 vilas, 1171 aldeias, 47 portagens, 6 fronteiras, 1 balança) e **5 de 11 províncias** (Zambézia, Sofala, Manica, Gaza, Cidade de Maputo; polígonos verificados). As restantes (Cabo Delgado, Nampula, Niassa, Inhambane, Maputo, Tete) foram recusadas pelos servidores Overpass gratuitos por excesso de carga; o job agendado tenta completá-las sozinho (1 tentativa a cada 30 min). Localidades sem província não mostram o evento "entrou na província" — nada é inventado.
- Jobs agendados: Neon Function `jobs` (a cada 5 min + diário às 00:15 UTC).
- Testes automáticos: **43 a passar** (6 ficheiros): motor de percurso e voz (15), assistente (2), fila offline (1), integração com Postgres/PostGIS real (23), importação OSM (1), migrações empacotadas (1).

## Relatório — Fase 1 (Fundação)
### Feito
- Vite puro multi-entrada (`index.html`, `track.html`, `driver.html`), TS strict, Tailwind, componentes base, i18n pt-MZ, formatos (MZN, Africa/Maputo, E.164) — **TESTADO** (build).
- Contas, organizações, membros, papéis, convites (link), planos, subscrições, auditoria, RLS por organização — **TESTADO**.
- Autenticação própria (sessão em cookie HttpOnly, bcrypt, limitação de tentativas, verificação de origem) — **TESTADO**.
### Como testar
Abrir o site → Criar conta → entra no painel. Definições → Membros → Convidar → copiar o link e abrir noutro navegador.
### Testes automáticos
RLS ativo em todas as tabelas; sem sessão não há acesso; login errado/certo; e-mail duplicado; **organização B não lê, não altera, não apaga e não insere dados de A em nenhuma das 40+ tabelas com `organization_id`** (SQL direto como `app_api`); anónimo não lê nada.
### ⚠️ Dependências externas
Recuperação de palavra-passe por e-mail: precisa de conta Resend (grátis) + `RESEND_API_KEY` + `EMAIL_FROM`. Sem isso a página diz que não está disponível.

## Relatório — Fase 2 (Frota)
### Feito
Camiões (matrícula única por organização, dimensões, fonte GPS prioritária, fotografia), motoristas, documentos com validade e ficheiro privado, estado derivado (`vehicle_status_v`), alertas de validade — **TESTADO** (API) / **IMPLEMENTADO** (ecrãs).
### Testes
Matrícula duplicada (normalizada) recusada; limite do plano (5 camiões no plano experimental) aplicado na BD; documento a expirar gera alerta pelo job.

## Relatório — Fase 3 (Viagens)
### Feito
Criar/editar viagens com paragens, máquina de estados no backend (`trip_transition`), eventos, linha do tempo, histórico com filtros, cancelamento com motivo obrigatório — **TESTADO**.
### Testes
Transições inválidas bloqueadas (422); outra organização não muda o estado (403); `UPDATE` direto ao estado recusado mesmo com permissão de escrita.

## Relatório — Fase 4 (GPS + mapa + inteligência de percurso)
### Feito
- Porta única de ingestão `POST /api/ingest` (telemóvel, simulador, dispositivo) e `/api/ingest/traccar`: validação, correção de relógio, deduplicação, saltos impossíveis, posições atrasadas sem regressão, viagem ativa no instante — **TESTADO**.
- Motor de percurso (`src/lib/geo`): projeção na rota com janela, km feitos/restantes monotónicos, localidades passada/atual/próxima, província, ETA com confiança, desvio com N pontos + duração, paragens, recálculo de rota após desvio — **TESTADO (simulador)**.
- Avisos por voz (tempo/distância/acontecimento, uma vez, intervalo mínimo, prioridade, filtro de importância) — **TESTADO (simulador)**; voz real no telemóvel: **não validada**.
- PWA do motorista: link + PIN, consentimento, GPS só em viagem, Wake Lock, fila offline IndexedDB ordenada, cálculo offline, assistente "Falar" — **IMPLEMENTADO** (fila e motor **TESTADOS**; GPS/voz/reconhecimento de voz em aparelho real **não validados**).
- Mapa ao vivo e detalhe da viagem (percurso feito sólido / por fazer tracejado, camião orientado e animado) — **IMPLEMENTADO**.
- Importação de províncias e localidades do OpenStreetMap (`tools/import-places`, ODbL) — **TESTADO** com resposta sintética; execução real: ver "Dependências".
- Simulador GPS (`npm run sim`) — **IMPLEMENTADO** (o gerador de posições é **TESTADO**).
### Testes
Viagem simulada com ruído, paragem de 25 min e perda de sinal: km feitos + restantes = rota ±1 %; localidades na ordem; sem desvio falso com ruído σ=60 m; desvio real de 2 km detetado uma vez e regresso detetado; avisos sem repetições e na ordem esperada; ETA com erro < 15 %.
### ⚠️ Dependências externas
- Rotas: Valhalla público da FOSSGIS (grátis, sem SLA). Opcional: `ORS_API_KEY` (OpenRouteService, grátis).
- Mapa: OpenFreeMap (grátis, sem SLA).
- Localidades: Overpass API (grátis). Se nenhum servidor responder a partir da Vercel, correr `npm run import:places` numa máquina com internet.

## Relatório — Fase 5 (Rastreamento público) — fim do MVP vendável
### Feito
Partilhas com código FT (a 1.ª usa o código da viagem) + token de 128 bits (só hash na BD), validade (chegada + 48 h), revogação/regeneração, contagem de acessos, WhatsApp com mensagem pronta, QR (PNG), página `/track` e `/track/:token` em entrada separada (~59 KB gzip antes do mapa), polling 20 s, pré-visualização Open Graph em `/t/:token` — **TESTADO**.
### Testes
O DTO público tem exatamente os campos da lista branca e não contém telefones, nomes privados nem IDs; após entrega mostra "entregue" e **não** mostra posição; revogado → indisponível; limitação de taxa → 429; código tolerante a minúsculas/sem hífen.

## Relatório — Fase 6 (Traccar + hardware)
Dispositivos por IMEI, histórico de associação sem sobreposições, chaves de ingestão (hash), formato de encaminhamento JSON do Traccar — **IMPLEMENTADO**. **Não testado com Traccar nem com equipamento real.**

## Relatório — Fase 7 (Alertas)
Regras por organização, alertas aberto/reconhecido/resolvido sem repetição, sem sinal, atraso (só com ETA fiável), desvio, paragem anormal, documentos, manutenção, dispositivo sem contacto, notificações na app, push web (VAPID) — **TESTADO** (motor e jobs); push no navegador **IMPLEMENTADO**. Jobs agendados por Neon Function a cada 5 min + diário.

## Relatório — Fase 8 (Custos e relatórios)
Combustível (consumo L/100 km entre depósitos cheios), manutenção (planos por data/km e registos), despesas de viagem (também pelo motorista), recibos, relatórios por camião/viagem, CSV — **TESTADO** (totais e consumo); o perfil "só leitura" não vê custos.

## Relatório — Fase 9 (Assistente de voz)
Perguntas locais ("Onde estou?", "Quanto falta?", "Próxima cidade?", "Quanto falta para X?", "A que horas chego?", "Em que província estou?") — **TESTADO**: sem dados responde sempre "Não tenho essa informação neste momento". Reconhecimento de voz depende do navegador (Chrome Android usa a rede) — **não validado**.

## Relatório — Fase 10 (Plataforma)
`/platform`: organizações, utilização, alterar plano, acesso de suporte (1–2 h, motivo obrigatório, auditado e notificado ao dono) — **TESTADO**. Limites de plano aplicados na BD. Para tornar alguém admin da plataforma: `update app_users set is_platform_admin = true where email = '…'` (feito pelo dono da BD).

## Relatório — Fase 11 (Produção)
Deploy Vercel (Build Output API, Node 22, região Frankfurt), migrações aplicadas no Neon através de endpoint de uso único (depois desativado), cabeçalhos de segurança, jobs agendados — **TESTADO** (`/api/health` 200, BD verificada). Teste de carga da ingestão e revisão de segurança externa: **não feitos**.

## Riscos e dívida técnica
- **Vercel Hobby é só para uso não comercial**: para vender, plano Pro (pago). Neon Free: 1 GB e o compute adormece (1.º pedido mais lento).
- GPS no navegador pára com o ecrã bloqueado; app nativa (Capacitor) é o passo seguinte para rastreamento contínuo pelo telemóvel.
- Rotas/mapa/Overpass gratuitos sem garantias. A velocidade "típica por troço" (`segment_speed_stats`) ainda não é alimentada: o ETA usa velocidade recente + duração do motor de rotas.
- Ficheiros guardados na BD (limite 1 GB do Neon Free): migrar para Object Storage quando crescer.
- Ecrãs testados por compilação e por testes de API; falta bateria E2E com Playwright e teste em telemóveis Android de gama baixa.

## Proposta seguinte
1. Testar com 2–3 telemóveis reais numa viagem Quelimane→Beira (GPS, voz offline, fila).
2. Domínio próprio e plano pago quando houver clientes (Vercel Pro).
3. App nativa (Capacitor) para GPS em segundo plano; testes Playwright E2E.
