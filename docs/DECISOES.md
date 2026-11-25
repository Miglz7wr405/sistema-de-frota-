# Registo de decisões (ADR)

> Formato curto: **Contexto → Decisão → Alternativas → Consequências**.
> Estado: `Proposta` (aguarda aprovação na Fase 0) · `Aceite` · `Substituída por ADR-N`.
> Valores marcados com ⚠️ **não foram confirmados** e têm de ser verificados antes de compromissos comerciais.

---

## ADR-000 — Frontend em Vite puro (SPA estática), sem Next.js
**Estado:** Aceite (pedido explícito do proprietário do produto).

**Contexto.** É preciso escolher como servir a aplicação web. Next.js/Remix trazem SSR e um servidor Node em produção; isto aumenta custo, complexidade de alojamento e superfície de ataque, e o backend já é o Supabase.

**Decisão.** A aplicação é uma **SPA construída com Vite** (React + TypeScript strict), servida como **ficheiros estáticos**. Node.js é usado **apenas** como ferramenta de desenvolvimento e build (`vite`, `vitest`, scripts em `tools/`). Em produção não há servidor Node nosso: estáticos num CDN + Supabase. Concretamente:
- **Multi-page build do Vite** com várias entradas HTML: `index.html` (landing + `/app` + `/login`…), `track.html` (`/track/*`), `driver.html` (`/driver/*`, PWA). Cada entrada tem o seu grafo de módulos: o código de `/app` nunca é descarregado por quem abre `/track`.
- Router: React Router em cada entrada. Regras de rewrite do alojamento: `/track/*` → `track.html`, `/driver/*` → `driver.html`, resto → `index.html`.
- PWA do motorista com `vite-plugin-pwa` (Workbox), âmbito limitado a `/driver/`.
- Lógica que precisa de servidor (validação, segredos, OG) vive em **Supabase Edge Functions** (Deno — imposição do Supabase, não uma escolha nossa de Node).

**Alternativas.** Next.js (rejeitado pelo proprietário; SSR desnecessário), Astro (multi-page bom, mas é outro framework), Vite com SSR próprio (reintroduz servidor Node).

**Consequências.** + Alojamento estático barato (Cloudflare Pages / Netlify / Vercel estático), simples e rápido em 3G. + Separação forte de bundles. − Metatags dinâmicas (Open Graph) impossíveis só com a SPA → ADR-011. − SEO só para páginas estáticas (landing), o que basta.

---

## ADR-001 — Fornecedor de mapas: MapLibre GL + tiles vetoriais OSM (PMTiles próprio)
**Estado:** Proposta.

**Contexto.** Mapas aparecem no dashboard, mapa ao vivo, detalhe de viagem, PWA e página pública. A página pública pode ser aberta muitas vezes por viagem; um fornecedor cobrado por carregamento de mapa torna o custo proporcional ao sucesso.

**Decisão.** **MapLibre GL JS** com **tiles vetoriais OpenStreetMap num único ficheiro PMTiles** (extrato de Moçambique + corredores vizinhos), gerado com Planetiler/Protomaps e alojado em armazenamento de objetos com pedidos *range* (Cloudflare R2 ou Supabase Storage atrás de CDN). Estilo próprio com as cores da marca. Acesso só via `src/lib/map/` (interface `MapProvider`).

**Estimativa de custo** (pressupostos: 1 viagem = ~10 aberturas de mapa entre dono, despachante e cliente; ~1,5 MB de tiles por abertura com cache do navegador; 30 dias):

| Viagens/dia | Aberturas/mês | Google Maps JS (Dynamic Maps) ⚠️ | MapLibre + PMTiles em R2 ⚠️ |
|---|---|---|---|
| 10 | ~3 000 | 0 USD (dentro da quota gratuita mensal) | ~0 USD (armazenamento < 1 USD) |
| 100 | ~30 000 | ~140 USD/mês (≈ 7 USD por 1000 acima da quota) | ~1–5 USD/mês |
| 1000 | ~300 000 | ~1 500–2 000 USD/mês | ~5–20 USD/mês (R2 não cobra saída; operações de leitura cobradas por milhão) |

⚠️ Os preços do Google Maps Platform mudaram em 2025 (quotas gratuitas por SKU); os números acima são aproximações a confirmar na página oficial de preços. Os custos do R2 também têm de ser confirmados.

**Alternativas.** Google Maps (melhor geocodificação e imagens, custo cresce com a página pública, termos restringem misturar com outros dados), MapTiler/Stadia geridos (bom plano B, cobram por pedidos de tiles), tiles raster OSM públicos (proibido usar `tile.openstreetmap.org` em produção comercial).

**Consequências.** + Custo quase fixo. + Funciona offline para o corredor (podemos guardar tiles em cache na PWA). − Somos responsáveis por gerar e atualizar o PMTiles (script em `tools/build-tiles`, mensal). − Qualidade do mapa depende do OSM em Moçambique (ver riscos). ⚠️ DEPENDÊNCIA EXTERNA: conta de armazenamento de objetos.

---

## ADR-002 — Motor de rotas para camiões: Valhalla (perfil `truck`) alojado por nós
**Estado:** Proposta.

**Contexto.** Distâncias têm de ser rodoviárias e adequadas a pesados. Google Directions não oferece perfil de camião fiável para Moçambique.

**Decisão.** **Valhalla** em Docker, com extrato OSM de Moçambique (+ Malawi, Zimbabué, África do Sul para L5 mais tarde), perfil `truck` com altura, largura, peso, eixos do camião. Chamado **só** pela Edge Function `route-plan` (a SPA nunca fala com o Valhalla). Resultados em `route_cache` (chave: origem/destino arredondados a ~100 m + perfil do camião + versão dos dados). Se o troço não tiver etiquetas de restrição (`maxweight`, `maxheight`, …), a viagem fica com `validated_for_truck = false` e a UI mostra **"Rota sugerida, não validada para veículos pesados"**. Para ser honesto: em Moçambique quase nenhuma estrada tem essas etiquetas, por isso o aviso será a regra no início.

**Alternativas.** OSRM (rápido, mas sem perfil de camião com restrições em tempo de pedido), GraphHopper (perfil truck só na versão comercial/API paga ⚠️ a confirmar), Google Routes (sem truck), fornecedores geridos de Valhalla (Stadia ⚠️ preços a confirmar).

**Consequências.** + Custo fixo baixo (VPS pequeno ⚠️ ~10–25 USD/mês para o extrato de Moçambique, a confirmar com teste de memória). + Controlo total. − Mais um serviço a operar (pode partilhar a máquina com o Traccar). ⚠️ DEPENDÊNCIA EXTERNA: VPS.

---

## ADR-003 — Fonte das localidades e províncias
**Estado:** Proposta.

**Decisão.**
- **Limites administrativos** (províncias e distritos): conjunto *Mozambique – Subnational Administrative Boundaries* (COD-AB) no **HDX/OCHA**. ⚠️ Licença e data exatas a confirmar na página do conjunto antes da importação; registadas em `admin_areas.source`.
- **Localidades e pontos de referência**: **OpenStreetMap** (extrato Geofabrik de Moçambique, licença ODbL): `place=city|town|village|hamlet`, `barrier=toll_booth`, `amenity=fuel`, `bridge=yes` com nome em estradas `trunk|primary`, `barrier=border_control`, `highway=checkpoint` quando existir.
- **Importância** (1–5) calculada: capital provincial 5, cidade 4, vila 3, aldeia sobre estrada nacional 2, outros 1; ajustável manualmente com registo.
- Script reprodutível `tools/import-places` (Node + `osmium`/`ogr2ogr` → SQL), que grava fonte, licença, data e versão em `geo_datasets`. Atribuição "© OpenStreetMap contributors" visível no mapa e na página pública.

**Alternativas.** GeoNames (útil para variantes de grafia; pode complementar), lista manual (proibida pelas regras do projeto).

**Consequências.** − Cobertura de aldeias e pontos de referência no OSM é desigual; o dono pode acrescentar locais privados. ODbL exige atribuição e partilha de melhorias à base de dados derivada se a distribuirmos.

---

## ADR-004 — Projeção na rota e cálculo do ETA
**Estado:** Proposta.

**Decisão — projeção.**
1. Rota planeada guardada como `geography(LineString)` e também com **medidas acumuladas em metros** por vértice (array `cum_m`).
2. Cada posição com precisão ≤ 100 m é projetada no segmento mais próximo **dentro de uma janela** à volta da última projeção (−2 km/+30 km), para não saltar para um troço paralelo nem para o regresso numa estrada de ida e volta. Em SQL equivale a `ST_LineLocatePoint` sobre a sub-linha; a mesma lógica existe em TypeScript puro (`src/lib/geo/progress.ts`) para o telemóvel offline.
3. **Monotonia:** `km_percorridos = max(anterior, nova)`; um recuo > 500 m sustentado por 3 posições só é aceite como "voltou para trás" (evento). Distância perpendicular > 500 m por N posições → candidato a desvio (regras da secção 6.12 do SPEC) → recálculo de rota a partir da posição atual (nova versão em `trip_routes`).
4. Localidades: cada `trip_route_places` tem `km_from_origin`; estado atual = `passada` se `km_percorridos ≥ km + raio`, `atual` se dentro do raio (raio por tipo: cidade 3 km, vila 1,5 km, ponto 300 m), senão `proxima`.

**Decisão — ETA.**
`ETA_localidade = agora + Σ troços restantes (km_troço / v_estimada)` com
`v_estimada = α·v_recente + (1−α)·v_típica_troço`, onde `v_recente` é a média móvel exponencial da velocidade **ao longo da rota** (Δkm projetado / Δt) nos últimos 20 min, excluindo paragens > 5 min; `v_típica_troço` vem de viagens anteriores (`segment_speed_stats`, por troços de 10 km) ou, sem histórico, da duração do Valhalla com fator de pesados (0,8 ⚠️ a calibrar). α começa em 0,3 e sobe para 0,6 quando há ≥ 20 min de dados.
**Confiança:** `alta` (posição Atual + ≥ 20 min de dados + histórico do troço), `media`, `baixa` ("Previsão aproximada"), `indisponivel` (sem posição Atual ou sem rota → "Previsão indisponível"). Nunca se mostra hora com confiança `indisponivel`.

**Alternativas.** Pedir ETA ao Valhalla a cada posição (caro, ignora o comportamento real do camião); linha reta (proibido).

**Consequências.** Testável de forma determinística com o simulador (Fase 4). A tabela `segment_speed_stats` só fica útil com algumas dezenas de viagens por corredor.

---

## ADR-005 — Voz sem rede
**Estado:** Proposta, com verificação obrigatória na Fase 4.

**Contexto.** `speechSynthesis` usa vozes do sistema. Em Android, o Chrome usa o motor TTS instalado (normalmente Google TTS); a voz pt-PT/pt-BR **pode** funcionar offline se o pacote de voz estiver descarregado, mas isso depende do aparelho. **Não tenho a certeza** do comportamento nos Android de gama baixa comuns em Moçambique; não existe voz "pt-MZ".

**Decisão.**
1. Na Fase 4, testar em 2–3 Android reais (gama baixa) em modo avião: `speechSynthesis.getVoices()` com `lang` `pt-PT`/`pt-BR` e `localService === true`.
2. Se houver voz local: usar `speechSynthesis` (preferir `pt-PT`, mais próxima da pronúncia moçambicana).
3. Se não houver: **plano B** — ao iniciar a viagem (com rede), a Edge Function `voice-pack` gera os áudios dos avisos previsíveis da rota (nomes das localidades × modelos de frase, ~30–80 clipes curtos) com um serviço TTS e a PWA guarda-os em Cache Storage; avisos com números (km/minutos) usam frases fixas por escalão ("Faltam 50 quilómetros…").
4. Ecrã de diagnóstico na PWA: "Testar voz sem rede".

**Consequências.** ⚠️ DEPENDÊNCIA EXTERNA (plano B): serviço TTS pago, custo por caractere a confirmar.

---

## ADR-006 — Realtime na área privada
**Estado:** Proposta.
Realtime (Postgres Changes) **apenas** sobre `vehicle_latest_positions`, `trip_progress`, `trips` e `alerts`, filtrado por `organization_id` e protegido por RLS. Histórico de posições nunca é transmitido; é consultado sob pedido (replay). Se o número de ligações crescer, migrar para canais Broadcast por organização emitidos pela própria `ingest-position`.

## ADR-007 — Página pública: *polling* à Edge Function (não Realtime)
**Estado:** Proposta.

**Decisão.** `GET public-tracking?token=…` a cada **20 s** enquanto a viagem está ativa e o separador visível (`visibilitychange`), 60 s quando escondido, parar quando `concluida`/`cancelada`. Resposta com `Cache-Control: public, max-age=10` e ETag, e cache em memória por token na função (10 s) para absorver vários clientes.

**Alternativas.** Canal Broadcast identificado pelo token (mais "ao vivo", mas mantém WebSockets abertos em telemóveis com rede fraca, consome ligações Realtime do plano e complica a limitação de taxa e a revogação).

**Consequências.** + Simples, barato, funciona em 3G intermitente, revogação imediata. − Latência até ~20 s; a animação suave interpola entre posições, o que basta para um camião.

## ADR-008 — Acesso do motorista: link + PIN no MVP, OTP por SMS depois
**Estado:** Proposta. **Confirmo a preferência (A no MVP, B mais tarde).**

**Decisão.** O dono gera um link pessoal (`/driver/entrar#<token 128 bits>`; o token vai no fragmento para não aparecer em logs de servidor) e define um PIN de 4–6 dígitos. A Edge Function `driver-session` verifica `hash(token)` + PIN (hash com Argon2id/bcrypt), limita tentativas (5 falhas → bloqueio de 15 min, alerta ao dono) e emite um **JWT de curta duração** (12 h, renovável) com claims `role=driver`, `driver_id`, `organization_id`, assinado com o segredo JWT do projeto, que as políticas RLS reconhecem. Revogável a qualquer momento (lista de revogação verificada na renovação e na ingestão).

**Porquê não B já:** custo e fornecedor de SMS em Moçambique por confirmar ⚠️; motoristas trocam de SIM; A funciona sem nenhuma dependência externa. B fica preparado (telefone E.164 já guardado).

**Riscos.** Partilha do link + PIN entre motoristas → mitigado por associação ao aparelho (identificador gerado na primeira entrada; novo aparelho exige confirmação do dono).

## ADR-009 — Formato do código de rastreamento
**Estado:** Proposta.
- **Código curto**: `FT-` + 8 caracteres do alfabeto Crockford Base32 **sem** `0 O 1 I L` (fica com 31 símbolos, ≈ 39,6 bits), apresentado `FT-7K3M-9QXP`. Entrada tolerante (minúsculas, sem hífenes, `o→0` não se aplica porque não existem). Único globalmente. Gerado com `crypto.getRandomValues`.
- **Token do link**: 128 bits aleatórios em base64url (22 caracteres). Guardado **só** `sha256(token)`; o código curto é guardado em claro (é para ditar) mas a consulta por código tem limitação de taxa mais apertada (ver SPEC 6.9).
- Regenerar = novo código + novo token; o anterior fica revogado.

## ADR-010 — Particionamento e retenção das posições
**Estado:** Proposta.

**Volume estimado:** 1 camião × 1 posição/15 s × 10 h/dia = **2 400 posições/dia**, **72 000/mês**. Com ~200 B por linha + índices (~350 B no total) ≈ **25 MB/camião/mês**. 20 camiões ≈ 0,5 GB/mês; 1 000 camiões ≈ 25 GB/mês.

**Decisão.** `vehicle_positions` com **particionamento declarativo nativo por mês** (`PARTITION BY RANGE (device_time)`), partições criadas antecipadamente por uma função agendada com **pg_cron** (sem depender de `pg_partman`, cuja disponibilidade no Supabase ⚠️ deve ser confirmada). Índices por partição: (`vehicle_id`, `device_time desc`), (`trip_id`, `device_time`) parcial onde `trip_id is not null`, BRIN em `device_time`. Retenção por plano: um job diário faz `DETACH`/`DROP` das partições fora da retenção do plano mais longo e apaga linhas das organizações com retenção menor. Ao concluir uma viagem, grava-se o percurso simplificado (`ST_SimplifyPreserveTopology`, ~10 m) em `trip_tracks` para replay permanente e barato.

## ADR-011 — Pré-visualização no WhatsApp (Open Graph) sem SSR
**Estado:** Proposta. Consequência direta do ADR-000.

**Decisão.** O link partilhado é `https://<domínio>/t/<token>`. O alojamento estático reescreve (proxy, não redirecionamento) `/t/*` para a Edge Function `track-preview`, que:
1. valida o token com as mesmas regras de `public-tracking` (taxa, validade, revogação);
2. devolve HTML de ~2 KB com `og:title` ("Viagem FT-7K3M-9QXP · Em viagem"), `og:description` ("Quelimane → Beira · 62 % concluído", só campos públicos), `og:image` estática da marca (imagem dinâmica fica para depois), `<meta name="robots" content="noindex">`;
3. redireciona o navegador para `/track/<token>` (meta refresh + `location.replace`).
Se o alojamento escolhido não suportar proxy para um domínio externo, usa-se um subdomínio (`t.<domínio>`) apontado para a função. ⚠️ Comportamento do *crawler* do WhatsApp com redirecionamentos e cache a validar com telemóvel real.

## ADR-012 — Alojamento do frontend
**Estado:** Proposta. **Cloudflare Pages** (estático, CDN com presença em Joanesburgo ⚠️ a confirmar a latência a partir de Maputo/Beira, regras `_redirects` com proxy para `/t/*`, plano gratuito generoso, e o mesmo fornecedor do R2 do ADR-001). Alternativas: Netlify, Vercel em modo estático. Nada depende do fornecedor além do ficheiro de rewrites.

## ADR-013 — Biblioteca de geometria partilhada entre servidor e telemóvel
**Estado:** Proposta. `src/lib/geo/` em TypeScript puro (sem DOM, sem Node APIs), importada pela SPA (Vite) e pelas Edge Functions (Deno). Testada com Vitest; um teste de equivalência compara os resultados TS com os do PostGIS para a rota de referência.

---

# Decisões da implementação (Fases 1–11, custo zero)

> Estas decisões substituem as indicadas, por imposição de "não pagar nada" e por o Supabase gratuito estar esgotado
> (a conta já tinha os 2 projetos gratuitos ativos e o proprietário não quis pausar nenhum).

## ADR-014 — Backend: Neon (Postgres) + API em Vercel Functions, sem Supabase
**Estado:** Aceite. Substitui o uso do Supabase em ADR-006/007/008/010/011.
- BD **Neon Free**, projeto `insightfrota`, região `aws-eu-central-1` (Frankfurt). PostGIS, pg_trgm, btree_gist, pgcrypto, citext.
- A SPA (Vite puro) fala só com `/api/*` (mesma origem). A API é **uma única Vercel Function** (Node 20, `fra1`) empacotada com esbuild via Build Output API (`scripts/build-vercel.mjs`). Uma só função porque o plano Hobby limita o n.º de funções.
- **Isolamento:** cada pedido corre numa transação com `set_config('app.user_id'|'app.org_id'|'app.driver_id')` usando o papel `app_api` **sem BYPASSRLS e sem ser dono das tabelas** — as políticas RLS aplicam-se sempre. Funções `SECURITY DEFINER` controladas para autenticação, partilha pública e ingestão.
- Ligação de **sistema** (`SYSTEM_DATABASE_URL`, papel dono, equivalente ao `service_role`) usada só no servidor para a ingestão GPS, jobs e migrações.
- **Consequências:** −Vercel Hobby é para uso não comercial ⚠️ (vender exige Pro, pago). −Neon Free: 1 GB por projeto, 5 GB de tráfego/mês, compute escala a zero (1.º pedido após inatividade mais lento).

## ADR-015 — Autenticação própria (sessões em BD)
**Estado:** Aceite. Em vez de Neon Auth/Supabase Auth: sessões com token aleatório de 256 bits em cookie `HttpOnly; Secure; SameSite=Lax`, guardado na BD só em hash (sha256), palavra-passe com bcrypt, limitação de tentativas, verificação de origem nos pedidos que alteram dados. Motivo: testável localmente de ponta a ponta, sem SDK externo, mesma base para membros e motoristas. Recuperação de palavra-passe por e-mail só com `RESEND_API_KEY` (⚠️ DEPENDÊNCIA EXTERNA, plano gratuito da Resend); sem ela, a UI diz que não está disponível. Convites geram um link para enviar manualmente (WhatsApp/e-mail).

## ADR-016 — "Tempo real" por polling
**Estado:** Aceite. A área privada atualiza por polling (10–20 s) e a página pública a cada 20 s (60 s em segundo plano). O Neon Realtime obrigaria a ativar replicação lógica (irreversível) — fica como melhoria opcional.

## ADR-017 — Ficheiros na BD (bytea, ≤ 2 MB)
**Estado:** Aceite para o MVP. Fotografias, recibos, assinaturas e documentos guardados na tabela `files` (RLS), comprimidos no navegador (JPEG, máx. 1600 px). Servidos só a quem tem acesso, nunca por URL pública. Migrar para o Neon Object Storage (5 GB grátis) quando o volume crescer.

## ADR-018 — Jobs por Neon Function + trigger de agenda
**Estado:** Aceite. `pg_cron` não serve (o compute escala a zero). Uma Neon Function mínima (`neon/functions/jobs`) chamada por trigger cron invoca `POST /api/jobs/run` (cabeçalho secreto). Reserva: a própria utilização do painel corre os jobs no máximo de 5 em 5 minutos.

## ADR-019 — Mapa e rotas gratuitos
**Estado:** Aceite. Substitui ADR-001/002 enquanto não houver orçamento.
- Mapa: MapLibre GL + **OpenFreeMap** (tiles vetoriais OSM, sem chave, sem SLA), atrás de `src/lib/map/MapProvider`.
- Rotas: **Valhalla público da FOSSGIS** (`costing: truck`) chamado só pelo servidor, com `route_cache` (30 dias); **OpenRouteService `driving-hgv`** primeiro se `ORS_API_KEY` existir. Sem resposta → "Rota indisponível" e nenhuma distância (nunca linha reta). Todas as rotas mostram "Rota sugerida, não validada para veículos pesados".

## ADR-020 — Motor de percurso único em TypeScript
**Estado:** Aceite (refina ADR-004/013). A projeção na rota, km, localidades, ETA, desvio, paragens e avisos por voz estão em `src/lib/geo/` (puro, sem DOM). O servidor usa-o na ingestão e o telemóvel usa-o offline. Após desvio confirmado, a rota é recalculada a partir da posição atual (`trip_routes.base_km` guarda os km já feitos). A província atual vem das localidades da rota (funciona sem polígonos no telemóvel).

## ADR-021 — Código da partilha
**Estado:** Aceite (refina ADR-009). A primeira partilha usa o próprio código da viagem (`FT-XXXX-XXXX`, 30 símbolos × 8 ≈ 39 bits); ao regenerar, código novo. O link usa token de 128 bits (só hash na BD); depois de criado só se mostra o link por código (`/track?code=`), com limitação de tentativas.

## ADR-022 — Camião em cima da estrada (ajuste à estrada) e teste com o telemóvel do dono
- **Decisão:** em cada envio de posições (no máximo 1 vez a cada 4 s por veículo) o servidor envia as últimas 12 posições GPS reais
  (precisão ≤ 100 m, últimos 10 min) ao Valhalla `trace_attributes` (FOSSGIS, grátis). Guarda o ponto ajustado, o nome da estrada e
  o limite de velocidade **só se a via tiver `maxspeed` no OpenStreetMap**. O ajuste fica ligado à posição exata de onde veio
  (`matched_at` = hora dessa posição): o camião é desenhado na estrada só quando o ajuste corresponde à última posição. Se o ponto
  ajustado estiver a mais de 60 m do GPS real, é recusado (nunca "arrasta" o camião para outra estrada). Se o serviço falhar, mostra-se a
  posição GPS bruta. Sem limite etiquetado aparece "limite desconhecido", nunca um valor inventado.
- **Teste com o telemóvel:** `/app/self-test` cria um camião de teste (`vehicles.is_test`, não conta para o limite do plano, 1 por
  organização) e um motorista ligado ao próprio utilizador (`drivers.user_id`). A viagem parte da **posição GPS real** do telemóvel
  (local privado da organização, com o nome da localidade real mais próxima) para um destino da base OSM, com rota real. O
  consentimento é aceite pelo próprio utilizador. O envio de posições passa a ser de 5 s em movimento.
- **Esquema do percurso:** linha com curvas desenhada em SVG (não é geografia), com as localidades reais da rota colocadas pela
  distância **rodoviária** desde a origem e o camião nos km feitos calculados pelo motor de percurso.
- **Velocidade:** é a do GPS do telemóvel; se o navegador não a der, é calculada entre duas posições consecutivas com precisão ≤ 30 m.
  A tendência ("a acelerar"/"a reduzir") compara as últimas velocidades reais.
- ⚠️ DEPENDÊNCIA EXTERNA: Valhalla público (sem SLA). **Não confirmado em produção** que o servidor FOSSGIS responde ao
  `trace_attributes` a partir da Vercel. Só se confirma com o 1.º teste real (verificar `road_name` no Neon).

## ADR-023 — "Nova viagem" só com Origem, Destino, Camião e Motorista
- **Decisão (pedido explícito do proprietário):** o formulário da viagem passa a ter só Origem, Destino, Camião e Motorista (com
  "+ Novo"), e o botão "Iniciar viagem agora" (partida = agora). Saíram do formulário: datas previstas, pontos de passagem, carga,
  peso, referência, destinatário e observações.
- **O que NÃO foi apagado:** a API (`POST/PATCH /api/trips`) e a base de dados mantêm todos esses campos; viagens antigas não perdem
  dados e uma integração futura pode continuar a enviá-los.
- Erros de validação do servidor passam a dizer o campo ("Verifique: Origem.") em vez de "Verifique os campos assinalados".

## ADR-024 — Painel: fotografia e camiões animados no cartão "viagem em curso" (2026-11-21)
- **Pedido do proprietário:** fotografia de camião ao fundo do cartão "viagem em curso", com animação de camiões a andar; atalhos "Registar camião" / "Registar motorista" no lugar do cartão de teste.
- **Exceção à regra "sem animações gratuitas":** a fotografia desliza devagar e dois ícones de camião andam numa estrada desenhada. Os camiões andam SEMPRE, mesmo com `prefers-reduced-motion` (pedido expresso do proprietário, cujo telemóvel tem essa opção ligada); só a fotografia para.
- **Fotografia:** fornecida pelo proprietário, convertida para WebP (640 px, ~80 KB) em `public/img/camiao-fundo.webp`. Só a área administrativa a carrega; a página pública `/track` não muda.
- ⚠️ DEPENDÊNCIA EXTERNA: confirmar que a fotografia pode ser usada comercialmente (direitos de imagem).

## ADR-025 — Câmara automática partilhada, Percurso automático, BI do motorista (2026-11-22)
- **Câmara do mapa:** a câmara automática (15 s rota inteira / 30 s aproximado, 15 s ao chegar a uma localidade, aviso "Agora em X") passou de `DriverMap` para `src/lib/map/useRouteCamera.ts`. É usada no ecrã do motorista, na página da viagem no painel e na página pública, para o computador ficar igual ao telemóvel. Só aproxima com posição real; sem sinal, mostra a rota inteira.
- **Separadores do ecrã do motorista:** alternam sozinhos, 105 s no Mapa e 15 s no Percurso. O mapa fica montado, por isso não recarrega.
- **Cartão "Tem uma viagem de X até Y":** aparece também no computador. Ao tocar, no telemóvel abre o ecrã do motorista; no computador abre a página da viagem.
- **BI do motorista (migração 0017):** `drivers.id_number` no formato de Moçambique, 12 algarismos + 1 letra, único por organização. É obrigatório no formulário e opcional na BD, porque os motoristas antigos e "Eu próprio" continuam válidos e o painel assinala "sem BI". O BI não é verificado numa base oficial (não há acesso); o formulário pede o nome "como no BI".
- **Ecrã do motorista:** o botão "Despesa" foi substituído pelo quadro "Feitos" (km feitos pelo motor de percurso). A API de despesas continua (Custos).

## ADR-026 — Voz dos distritos: gravações estáticas ElevenLabs + voz do telemóvel (2026-11-22)
- **Frases:** "Chegou ao distrito de X." ao entrar num distrito e "Falta pouco para chegar ao distrito de Y." 5 km antes; nas cidades capitais, "Chegou à cidade de X." / "Falta pouco para chegar à cidade de X.". Cada aviso é dito uma só vez; ao reabrir a app não repete os distritos que ficaram para trás.
- **Distritos:** limites ADM2 do geoBoundaries (CC BY 4.0, origem OCHA COD-AB), importados pela tarefa periódica (`completeDistricts`). A produção tem 156. Os km de entrada em cada distrito calculam-se sobre a rota rodoviária real (`routeDistricts`).
- **Áudio:** gravado antes no ElevenLabs (voz "Dinis", pt-PT, `eleven_multilingual_v2`) e guardado em `public/voz/*.mp3` (mono 48 kbps, ~10 KB cada). Não há chave de API nem pedidos ao ElevenLabs durante a viagem. As gravações da rota são descarregadas quando a viagem abre, por isso tocam sem rede.
- **Distritos sem gravação:** a mesma frase é dita pela voz do telemóvel.
- **Estado (2026-11-25): todos os 156 distritos gravados**, 312 frases (`src/driver/voz-manifest.json`). Inclui as 11 capitais, que dizem "cidade de X". Um script confirmou que cada distrito de `admin_areas` tem as frases `-chegou` e `-falta`.
  - **Contas usadas:** a 2.ª conta ElevenLabs gastou ~8 600 créditos; a 3.ª conta gastou ~5 900 nos 15 lotes finais.
  - **Voz do telemóvel:** só se usa se aparecer um distrito novo na base.
- **Uso comercial:** depende dos termos do plano ElevenLabs. As gravações foram feitas em planos gratuitos. ⚠️ DEPENDÊNCIA EXTERNA: confirmar a licença antes do lançamento comercial.

## ADR-027 — Distritos visíveis ao cliente e no painel (2026-11-23)
- **Lista branca do DTO público (migração 0018):** passa a incluir `districts` (nome, província e km de entrada ao longo da rota) e `district` (distrito e província da última posição real, só com viagem ativa). Nenhuma geometria nem dado privado é exposto.
- **`route_districts(route)`:** uma única função SQL, usada pela página pública, pelo painel e pelo ecrã do motorista. Ignora passagens de menos de 1 km por um distrito, porque são a estrada a tocar num limite.
- **Página pública:** o camião deixa de ter a etiqueta grande por cima dos nomes do mapa (o "Agora: …" já está no cartão). O nome da origem e o do destino escondem-se quando o camião está a menos de 3 km deles.
- **Percurso:** mostra as entradas nos distritos, por exemplo "DISTRITO DE NICOADALA · km 9", entre as localidades.

## ADR-028 — Pagamento por viagem com M-Pesa / e-Mola, sem API paga (2026-11-23)
- **Regra:** a 1.ª viagem real de cada organização é grátis. As seguintes custam o preço definido no painel da plataforma (250 MT). A viagem só começa com o pagamento **aprovado**; o bloqueio está na BD (gatilho `trips_payment_gate`), por isso não se fura pela API.
- **Isentos:** a viagem de teste do telemóvel e a empresa do próprio dono da plataforma.
- **Fraude:** uma fotografia de comprovativo pode ser editada (IA, montagem), por isso **a fotografia nunca aprova sozinha**. A leitura (tesseract.js no telemóvel, grátis) só serve para filtrar:
  - preenche o código;
  - recusa valor errado, número de destino errado, comprovativo com mais de 48 h e imagens que não são comprovativos;
  - cada código de transação só pode ser usado uma vez (índice único).
- **Prova do pagamento:** é o SMS do M-Pesa/e-Mola que chega ao telemóvel do proprietário. Esse SMS só existe se o dinheiro entrou.
- **Como os SMS chegam ao sistema:** uma app gratuita de reencaminhar SMS no Android envia-os para `POST /api/payments/sms`, protegido pelo segredo `PAYMENTS_SMS_SECRET`. O pagamento pendente com o mesmo código, ou do mesmo número com o valor certo (24 h), é aprovado sozinho e a viagem começa.
- **Mensagens Google:** não servem para isto. Não têm forma de outro sistema ler os SMS; messages.google.com é só para leitura humana.
- **Sem SMS correspondente:** o proprietário aprova ou rejeita no painel, com a fotografia, os campos lidos e os SMS candidatos. 3 rejeições bloqueiam a conta até ele a desbloquear.
- ⚠️ DEPENDÊNCIA EXTERNA:
  - os números M-Pesa/e-Mola (definidos no painel);
  - a app de reencaminhar SMS;
  - os formatos reais dos SMS e dos comprovativos não estão testados: afinar com 1 ou 2 exemplos verdadeiros;
  - a língua do OCR (`por.traineddata`) vem do CDN do tessdata na 1.ª leitura.
