# insightFrota — Especificação oficial (v0.1, Fase 0)

> "Sua frota sempre sob controlo."
> Documento de referência do produto. As decisões técnicas e as suas justificações estão em `DECISOES.md`;
> o modelo de dados em `MODELO-DADOS.md`; os fluxos em `FLUXOS.md`; riscos e custos em `RISCOS-E-CUSTOS.md`;
> o plano de fases em `PLANO.md`.
>
> Estado deste documento: **proposta para aprovação**. Nada aqui está implementado.

---

## 1. Produto

**Problema.** O dono de um camião em Moçambique não sabe onde o camião está, controla mal os motoristas e passa o dia ao telefone a responder a clientes que perguntam "onde está a minha carga?".

**Solução.** Plataforma SaaS de gestão e rastreamento de frotas. Cada viagem gera um **código curto** e um **link** que o dono envia ao cliente (sobretudo por WhatsApp). O cliente vê o camião no mapa, o progresso ao longo da estrada e a chegada prevista, **sem criar conta**.

**Princípio de decisão:** um sistema poderoso por trás, extremamente simples para quem o utiliza.

**Mercado inicial:** Moçambique (Quelimane–Beira, Maputo–Xai-Xai, corredor da Beira, N1).
**Clientes iniciais:** proprietários individuais e pequenas transportadoras (1 a 20 camiões).

**Formato técnico (resumo):** aplicação web **Vite puro** (SPA estática, sem Next.js nem SSR) + PWA do motorista + backend Supabase (Postgres/PostGIS, Auth, Realtime, Storage, Edge Functions). Ver ADR-000.

---

## 2. Perfis e permissões

| Perfil | Onde entra | Pode | Não pode |
|---|---|---|---|
| **Proprietário** (`owner`) | `/app` | Tudo da sua organização, incluindo faturação, membros, eliminar organização | Ver outras organizações |
| **Administrador** (`admin`) | `/app` | Como o proprietário, exceto transferir a propriedade e eliminar a organização | — |
| **Gestor / Despachante** (`dispatcher`) | `/app` | Viagens, mapa, motoristas, camiões, partilhas, alertas, custos de viagem | Plano/faturação, membros, chaves de ingestão, eliminar registos definitivamente |
| **Só leitura** (`viewer`) — *novo* | `/app` | Ver dashboard, mapa, viagens, relatórios | Alterar o que quer que seja |
| **Motorista** | `/driver` (link + PIN) | Ver e operar só as viagens atribuídas a si; enviar posições, ocorrências e comprovativos | Ver outros motoristas, custos, clientes que não sejam o destinatário da sua viagem |
| **Cliente final** | `/track`, `/track/:token` | Ver o DTO público de **uma** viagem | Qualquer outra coisa |
| **Admin da plataforma** (Insight) | `/platform` | Organizações, planos, limites, utilização, suporte | Ver dados operacionais sem "acesso de suporte" registado em `audit_logs` e limitado no tempo |

O motorista **não é membro** da organização (não tem `auth.users` com e-mail); autentica-se por token + PIN e recebe uma sessão de âmbito restrito (ADR-008).

---

## 3. Âmbito: MVP vs futuro

**MVP vendável = Fases 1 a 5** (ver `PLANO.md`).

| Área | MVP | Futuro |
|---|---|---|
| Organizações, membros, papéis, RLS | ✅ | SSO, 2FA obrigatório |
| Camiões, motoristas, documentos com validade | ✅ | OCR de documentos |
| Viagens + máquina de estados + linha do tempo | ✅ | Viagens multi-entrega com vários destinatários (ver lacuna L4) |
| GPS por telemóvel (PWA) + simulador | ✅ | App nativa (Capacitor) com GPS em segundo plano |
| GPS físico via Traccar | Fase 6 | — |
| Inteligência de percurso (km pela estrada, localidades, ETA) | ✅ | ETA aprendido por troço com muitos dados |
| Avisos por voz básicos (tempo/distância/acontecimento) | ✅ | Perguntas por voz ("Quanto falta?") |
| Página pública + código + link + WhatsApp + QR | ✅ | Notificações automáticas ao cliente por WhatsApp/SMS |
| Alertas (regras + motor) | Fase 7 (só "sem sinal" e "documento a expirar" no MVP) | E-mail, SMS, WhatsApp |
| Custos e relatórios | Fase 8 | Exportação para contabilidade |
| Plataforma SaaS (`/platform`, planos, limites) | Tabelas e verificação de limites desde a Fase 1; UI na Fase 10 | Pagamentos (M-Pesa, e-Mola, cartão) |

---

## 4. Correções à especificação original (aplicadas)

1. **Multi-tenant por organização** (`organizations` + `organization_members.role`), nunca por `owner_id`.
2. **Código de rastreamento não adivinhável:** `FT-XXXX-XXXX` (8 caracteres Crockford Base32, ~40 bits) para ditar; **link com token de 128 bits** (guardado só em hash) para WhatsApp/QR; limitação de tentativas, validade, revogação, registo de acessos. ADR-009.
3. **Fatias verticais** em vez de "toda a UI primeiro"; rastreamento público dentro do MVP.
4. **Simulador GPS** (`tools/gps-simulator`) que reproduz rotas reais com ruído, paragens e perda de sinal, pelo mesmo endpoint.
5. **Uma só porta de entrada para posições:** Edge Function `ingest-position`.
6. **Realtime só sobre `vehicle_latest_positions`**; histórico sob pedido.
7. **Página pública sem Realtime:** *polling* à Edge Function `public-tracking` (ADR-007).
8. **Rotas para camiões:** Valhalla com perfil `truck`; aviso "Rota sugerida, não validada para veículos pesados" quando não há dados de restrições (ADR-002).
9. **Custos de mapas:** MapLibre GL + tiles vetoriais OSM em ficheiro PMTiles alojado por nós, atrás de `MapProvider` (ADR-001).
10. **WhatsApp como canal principal:** botão com mensagem pronta e pré-visualização Open Graph. Numa SPA Vite pura isto exige a Edge Function `track-preview` (ADR-011, lacuna L1).
11. **Documentos genéricos** em `documents` (polimórfico veículo/motorista).
12. **Histórico de associação dispositivo↔camião** em `device_assignments` (`valid_from`/`valid_to`).
13. **Estado do veículo parcialmente derivado** (secção 6.3).
14. **Português de Moçambique** na interface ("camião", "telemóvel", "matrícula", "portagem").

## 5. Lacunas novas identificadas (acrescentadas a esta especificação)

| # | Lacuna | Resolução proposta |
|---|---|---|
| L1 | **Open Graph numa SPA pura não funciona.** O WhatsApp e o Facebook não executam JavaScript; num Vite puro todas as rotas devolvem o mesmo `index.html`, logo a pré-visualização seria genérica. | O link partilhado é `https://<domínio>/t/<token>`, servido por uma regra do alojamento estático que encaminha para a Edge Function `track-preview`. Esta devolve um HTML mínimo com metatags OG (estado, origem → destino, sem dados privados) e `<meta http-equiv="refresh">` + `location.replace` para `/track/<token>` na SPA. Sem servidor Node, sem SSR. ADR-011. |
| L2 | **Consentimento e privacidade do motorista.** Rastrear um trabalhador tem implicações legais (a Lei moçambicana de proteção de dados e as regras laborais aplicáveis **não foram verificadas**). | O telemóvel só envia posições com viagem ativa (ou turno ativo explicitamente iniciado). Ecrã de consentimento com registo (`driver_consents`). Política de privacidade revista por jurista antes do lançamento. ⚠️ DEPENDÊNCIA EXTERNA: parecer jurídico. |
| L3 | **Relógios errados nos telemóveis.** Android de gama baixa tem frequentemente data/hora errada; o timestamp do dispositivo pode estar horas adiantado ou atrasado. | Guardar `device_time` **e** `received_at` (servidor). Se o desvio for > 5 min com rede ativa, corrigir com o desfasamento medido no momento do envio (o cliente envia também `sent_at` do lote). Frescura calculada sempre com hora do servidor. |
| L4 | **Viagens com várias entregas/destinatários.** O camião sai de Quelimane com carga para três clientes (Caia, Inchope, Beira). Uma só partilha mostraria a um cliente as entregas dos outros. | `trip_stops` com tipo (`entrega`, `recolha`, `passagem`) e destinatário opcional; `tracking_shares` pode ser limitado a uma paragem (`stop_id`): o cliente vê o trajeto até à **sua** entrega e "Entregue" quando chega a sua paragem. MVP: uma partilha por viagem; o modelo já suporta várias. |
| L5 | **Viagens transfronteiriças** (Machipanda→Zimbabué, Ressano Garcia→África do Sul, Malawi). | `places` e rotas não podem assumir só Moçambique: importar também os corredores dos países vizinhos para o motor de rotas; tempo de espera em fronteira como paragem conhecida (não gera "paragem anormal"); moeda por despesa. MVP: só território nacional, documentado como limitação. |
| L6 | **Custo dos dados móveis do motorista.** O pacote de dados é pago (muitas vezes pelo próprio motorista). | Lotes comprimidos (até 20 posições por pedido), intervalos adaptativos, geometria da rota simplificada (< 200 KB por viagem) e tiles do corredor em cache. Mostrar ao dono o consumo médio estimado por viagem. |
| L7 | **Saída de um cliente do SaaS** (exportar e apagar dados). | Exportação CSV/GeoJSON por organização e eliminação com período de graça (30 dias), registada em auditoria. |
| L8 | **Viagem sem fonte de GPS.** Camião sem dispositivo e motorista sem smartphone. | A viagem existe na mesma; a página pública mostra estado manual ("Partiu", "Chegou a Caia" marcado pelo despachante) e **nunca** posição, km ou ETA. Estado explícito "Sem rastreamento GPS". |
| L9 | **Duas fontes ao mesmo tempo** (GPS físico + telemóvel do motorista). | Prioridade configurável por veículo (por omissão: dispositivo físico). As duas são gravadas; `vehicle_latest_positions` e o progresso usam a fonte prioritária enquanto estiver "Atual", e a outra como reserva. |
| L10 | **Revogar o acesso de um motorista que sai da empresa** com o telemóvel ainda com a PWA aberta e fila offline. | Revogação invalida a sessão; posições em fila enviadas após a revogação são aceites só se o `device_time` for anterior à revogação e a viagem lhe estivesse atribuída. |

---

## 6. Requisitos funcionais por módulo

### 6.1 Autenticação e organizações
- RF-AUTH-1 Registo com e-mail + palavra-passe (Supabase Auth); confirmação de e-mail; recuperação de palavra-passe.
- RF-AUTH-2 No registo cria-se a organização (nome, telefone E.164, província) e o utilizador fica `owner`.
- RF-AUTH-3 Convites por e-mail com papel; aceitação liga o utilizador à organização. Um utilizador pode pertencer a várias organizações e escolher a ativa.
- RF-AUTH-4 Remover membro e alterar papel ficam em `audit_logs`. Tem de existir sempre ≥ 1 `owner`.

### 6.2 Dashboard (`/app/dashboard`)
Cartões: total de camiões, em viagem, disponíveis, em manutenção, sem sinal. Mapa da frota (miniatura), alertas abertos, viagens em curso (código, rota, camião·motorista, progresso, chegada, estado), manutenções e documentos a expirar. Atualização via Realtime sobre `vehicle_latest_positions`, `trips` e `alerts`.
Referência visual: `docs/referencias/01-dashboard.png`.

### 6.3 Camiões (`/app/vehicles`)
- Campos: matrícula (única por organização, normalizada em maiúsculas sem espaços duplos), marca, modelo, ano, tipo (rígido, trator, basculante, cisterna, frigorífico, outro), capacidade (t), peso bruto (t), dimensões C×L×A (m), eixos, quilometragem, fotografia, prioridade de fonte GPS, estado administrativo.
- **Estado guardado vs derivado:**
  - Guardado (`vehicles.admin_status`): `ativo`, `em_manutencao`, `inativo`. Só uma pessoa o altera.
  - Derivado da operação: `em_viagem` se existir viagem em `em_viagem`/`pausada`; `disponivel` se ativo e sem viagem ativa.
  - Derivado da telemetria (frescura): `atual`, `desatualizada`, `sem_sinal`, `sem_dispositivo`; e `em_movimento`/`parado` pela velocidade.
  - A UI mostra **um rótulo principal** com esta prioridade: Em manutenção > Inativo > Em viagem (+ sinal) > Disponível (+ sinal). "Sem sinal" é um selo adicional, não substitui "Em viagem". Implementado por uma vista `vehicle_status_v` para nunca haver duas fontes de verdade.
- Detalhe: viagens, motorista habitual (calculado), última posição, documentos, manutenção, custos.
Referência: `03-camioes.png`.

### 6.4 Motoristas (`/app/drivers`)
Nome, telefone E.164, fotografia, carta de condução (número, categoria, validade) como `documents`, estado (`ativo`, `inativo`), acesso à PWA (gerar link + PIN, revogar, último acesso). Alertas de validade 30/15/7 dias (configurável por organização).

### 6.5 Documentos
Tabela única `documents` (veículo **ou** motorista): tipo (carta de condução, seguro, inspeção, licença de transporte, manifesto, livrete, outro), número, emissão, validade, ficheiro no bucket privado `documents`, servido por URL assinada (≤ 5 min). Estado calculado: `valido`, `a_expirar`, `expirado`, `sem_validade`.

### 6.6 Viagens (`/app/trips`)
- Campos: camião, motorista, origem e destino (`places` público ou local privado, ou ponto marcado no mapa), pontos de passagem/entregas (`trip_stops`), partida e chegada previstas, mercadoria, peso, destinatário (nome e telefone **privados**), observações, referência interna do cliente.
- Ao gravar: pedido ao motor de rotas (via Edge Function `route-plan`, com `route_cache`) → `trip_routes` (geometria, comprimento, duração, perfil, `validated_for_truck`) → `trip_route_places` ("horário de comboio").
- **Máquina de estados** (aplicada no backend por função `trip_transition()` `SECURITY DEFINER`; transições inválidas devolvem erro):

| De → Para | Quem |
|---|---|
| `planeada → aguardando_partida` | owner/admin/dispatcher (automático quando motorista e camião atribuídos e faltam < 24 h) |
| `aguardando_partida → em_viagem` | motorista (Iniciar) ou dispatcher+ |
| `em_viagem → pausada` / `pausada → em_viagem` | motorista ou dispatcher+ |
| `em_viagem|pausada → concluida` | motorista (Terminar / Confirmar entrega) ou dispatcher+ |
| `planeada|aguardando_partida|em_viagem|pausada → cancelada` | owner/admin/dispatcher (motivo obrigatório) |
| `concluida`, `cancelada` | estados finais; reabrir só por owner/admin com registo em auditoria |

- Restrições: um camião só pode ter **uma** viagem em `em_viagem|pausada` (índice único parcial); idem para o motorista.
- **"Atrasada" não é estado**: indicador `is_late = eta > planned_arrival + tolerância` (tolerância por organização, por omissão 30 min) e só quando o ETA tem confiança suficiente.
- **Linha do tempo** (`trip_events`): criada, atribuída, partida, paragem detetada (início/fim), chegada a ponto, passagem por localidade, entrada em província, ocorrência, desvio, recálculo de rota, edição, comprovativo, chegada, cancelamento.
Referência: `02-detalhe-viagem.png`.

### 6.7 Inteligência de percurso
- **Base geográfica**: `admin_areas` (11 províncias + distritos, polígonos) e `places` (cidades, vilas, localidades, pontes, portagens, postos de controlo, balanças, combustível, fronteiras) importados por `tools/import-places` a partir de fontes documentadas (ADR-003). Nunca escritos à mão. Variantes de grafia (`Xai-Xai`/`Chai-Chai`). Locais privados da organização (armazéns, clientes, oficinas) na mesma tabela com `organization_id`.
- **Distâncias rodoviárias** sempre pelo motor de rotas. Ferramenta "Distâncias" (`/app/distances`): duas localidades → km, tempo, estradas, lista de localidades. Nunca linha reta.
- **Progresso ao vivo** (ADR-004): projeção de cada posição na geometria da rota; km percorridos (monotónicos, com tolerância), km restantes, %, localidade atual/"Entre X e Y"/"A N km de Z", província atual, próxima localidade, ETA por localidade com confiança, deteção de desvio e recálculo.
- **Estados das localidades**: `passada` (com hora real), `atual`, `proxima` (com hora prevista).
- Mesmo cálculo no servidor (verdade para dono e cliente) e no telemóvel (offline, para voz). Ambos usam a **mesma biblioteca TypeScript** `src/lib/geo/progress.ts` (pura, sem dependências de DOM), executada no navegador e nas Edge Functions (Deno importa TS diretamente). Testes de equivalência garantem o mesmo resultado.

### 6.8 GPS e ingestão
- Fontes: PWA do motorista, Traccar (dispositivo físico), simulador. Todas → `ingest-position`.
- Validação (Zod): lat ∈ [-90, 90], lng ∈ [-180, 180], fora de (0,0); `device_time` ≤ agora + 2 min (após correção de relógio, L3); precisão ≤ 500 m para entrar no progresso (pior precisão é gravada mas marcada `low_accuracy`); velocidade implícita entre posições consecutivas ≤ 160 km/h → `rejected_jump`.
- Deduplicação por (`source_id`, `device_time`). Posições atrasadas aceites sem sobrescrever uma mais recente em `vehicle_latest_positions`.
- Associação ao veículo pela `device_assignments` válida em `device_time`; associação à viagem ativa do veículo nesse instante.
- Escrita do histórico e *upsert* condicional da última posição na **mesma transação** (função SQL `ingest_positions(jsonb)`).
- Limitação de taxa por dispositivo (por omissão 1 pedido/5 s, lotes até 50 posições).
- Frescura: **Atual** < 2 min, **Desatualizada** 2–15 min, **Sem sinal** > 15 min (configurável). Sempre "última atualização há X min".
- Intervalos: em movimento 15 s (10–30), parado 2 min (1–5); configurável.

### 6.9 Rastreamento público (diferencial)
- Rotas: `/track` (introduzir código) e `/track/:token`; link de partilha `/t/:token` (passa por `track-preview` para OG, ver L1).
- `public-tracking` (Edge Function) valida existência, ativo, validade, revogação e taxa; devolve **só** o DTO público (lista branca): código, estado, origem/destino (nome), localidades principais da rota com estado e horas, posição (lat/lng/rumo) e frescura, percurso feito e por fazer (simplificados), km restantes, %, ETA e confiança **quando calculáveis**; opcional: nome/logótipo da transportadora, matrícula parcialmente oculta (`ADF ••• MP`), primeiro nome do motorista.
- **Nunca**: telefones, documentos, valores, outros clientes, IDs internos, histórico fora da viagem.
- Após `concluida`: "Entregue às HH:MM", sem posição do camião. Após `cancelada`: "Viagem cancelada", sem posição.
- Limitação: por IP 30 pedidos/min ao endpoint; tentativas de código errado: 10 por IP por 15 min, depois bloqueio crescente. Por omissão, validade = chegada prevista + 48 h.
- Gestão (privado): gerar, copiar link, **Enviar por WhatsApp** (`https://wa.me/?text=` com mensagem pronta em pt-MZ), QR (PNG), validade, desativar, revogar e regenerar, n.º de acessos.
- Design: mapa em ecrã inteiro, cartão inferior com estado, barra verde de progresso, km restantes, chegada prevista, linha do tempo simplificada. Referência: `04-track-publico-telemovel.png`.

### 6.10 PWA do motorista (`/driver`)
- Entrada por link pessoal (token) + PIN de 4–6 dígitos (ADR-008).
- Ecrãs com botões grandes: viagem atual, iniciar, pausar/retomar, ocorrência (avaria, acidente, controlo policial, estrada cortada, outra; foto opcional), chegar a ponto, entregar (foto, nome de quem recebeu, assinatura), terminar.
- Indicador permanente: "GPS a enviar · última há 12 s · 0 em fila" / "Sem sinal GPS" / "Sem rede · N em fila".
- Honestidade técnica (mostrada na UI e na documentação): **no navegador o rastreamento pára ou degrada-se com o ecrã bloqueado ou a app em segundo plano.** Mitigações: Wake Lock API, aviso "Mantenha esta página aberta", fila offline em IndexedDB com reenvio. App nativa (Capacitor + geolocalização em segundo plano) planeada como fase futura.
- Com o veículo em movimento (> 10 km/h): interface reduzida (só "Falar", estado e próximo ponto), formulários bloqueados.
- Ao iniciar a viagem: descarrega geometria da rota, localidades do corredor e, se possível, tiles do corredor (L6).
Referência: `05-motorista-pwa.png`.

### 6.11 Avisos por voz e assistente
- Gatilhos por tempo ("Faltam 15 minutos para Caia"), distância ("Faltam 50 km para o destino") e acontecimento ("Está a entrar em Caia", "Entrou na província de Sofala", "Chegou ao destino", "Viagem iniciada", "A localização deixou de ser atualizada").
- Regras: uma vez por aviso (chave idempotente `trip_id + tipo + alvo + limiar`), histerese, intervalo mínimo 2 min com prioridade, avisos por tempo só com confiança de ETA ≥ média (senão usa distância), filtro por importância da localidade, silenciar, registo em `voice_announcements`.
- Fase 9: perguntas por voz com correspondência local de intenções; resposta só com dados calculados, senão "Não tenho essa informação neste momento."

### 6.12 Alertas (Fase 7; parcial no MVP)
Tipos: início, chegada, chegada a ponto, sem comunicação, atraso, desvio, paragem anormal, manutenção próxima, documento a expirar, dispositivo com problemas. Estados `aberto → reconhecido → resolvido`; não repete enquanto aberto. Regras anti-falsos-positivos (desvio com N=3 posições consecutivas, precisão < 100 m, fora de corredor de 500 m, durante ≥ 3 min; paragem anormal com velocidade < 3 km/h num raio de 150 m durante > 30 min fora de locais conhecidos). Canais: na app e push web; `notification_channels` prevê e-mail, SMS e WhatsApp.

### 6.13 Custos e relatórios (Fase 8)
Manutenção (próxima por data **ou** km), combustível (litros, valor, km, posto; consumo L/100 km calculado entre abastecimentos cheios), despesas de viagem (portagens, alimentação, alojamento, reparações, outras) com recibo opcional. Montantes em `numeric(14,2)` + `currency` (por omissão MZN). Resumos por camião, viagem e período.

### 6.14 Plataforma (Fase 10; tabelas desde a Fase 1)
Organizações, planos, `subscriptions`, limites (camiões, dispositivos, retenção de histórico, partilhas ativas, membros) verificados **no backend** (triggers/funções), utilização (`usage_counters`), suporte com acesso temporário auditado.

---

## 7. Requisitos não funcionais

| Código | Requisito | Meta / verificação |
|---|---|---|
| RNF-1 | **Frontend Vite puro** (SPA estática). Sem Next.js, sem SSR, sem servidor Node em produção. | Build = ficheiros estáticos em `dist/`. ADR-000. |
| RNF-2 | Página pública leve em 3G | Entrada Vite separada (`track.html`). JS inicial (sem mapa) ≤ 60 KB gzip; MapLibre carregado a seguir. LCP ≤ 4 s em "Slow 4G"/Moto G4 no Lighthouse. Nenhum módulo de `/app` no grafo de `/track` (teste automático sobre o manifest do build). |
| RNF-3 | Landing | Lighthouse ≥ 90 (Performance, Acessibilidade, Boas práticas, SEO). |
| RNF-4 | Estados de ecrã | Todos os ecrãs têm: a carregar, vazio, erro, sem ligação, dados desatualizados. |
| RNF-5 | Segurança | RLS em todas as tabelas `public`; isolamento por organização; testes A↔B; segredos fora do frontend; buckets privados; auditoria. |
| RNF-6 | Ingestão | p95 < 300 ms por lote de 20 posições; 50 posições/s sustentadas na Fase 11 (teste de carga). |
| RNF-7 | Offline (motorista) | Cálculo de km, localidade atual e voz funcionam sem rede; fila sobrevive a fechar o navegador. |
| RNF-8 | Língua e formatos | pt-MZ em `src/i18n/pt-MZ.ts`; `1 250,00 MT`; `Africa/Maputo`; `timestamptz` em UTC; E.164. |
| RNF-9 | Acessibilidade | Contraste WCAG AA para todos os tokens (incluindo `warning` e `danger`), alvos de toque ≥ 44 px (≥ 56 px na PWA do motorista). |
| RNF-10 | Browsers alvo | Chrome Android ≥ 2 últimas versões estáveis e Android WebView; Safari iOS 16+; Chrome/Edge/Firefox desktop recentes. ⚠️ A confirmar com dados de utilização reais em Moçambique. |
| RNF-11 | Observabilidade | Logs estruturados nas Edge Functions, métricas de ingestão (aceites/rejeitadas por motivo), alertas de erro. |

## 8. Identidade visual
Tokens do `CLAUDE.md` (`primary #1769E8`, `navy #10243D`, `background #F5F7FA`, `surface #FFFFFF`, `muted #64748B`, `success #16A36A`) mais propostas a validar na Fase 1:
`warning #B45309` (texto âmbar sobre branco, contraste ≈ 5:1) com fundo `#FEF3C7`; `danger #C62828` (≈ 5,6:1) com fundo `#FDECEC`. Contrastes a verificar por ferramenta na Fase 1 — valores aproximados, não confirmados.
Cartões com borda 1 px, raio 12–16 px, sombra mínima. Única animação obrigatória: movimento suave do camião.

## 9. Critérios de aceitação globais do MVP (fim da Fase 5)
1. Org A não lê, não altera e não apaga dados da org B (teste automático para cada tabela privada).
2. Simulador Quelimane→Beira move o camião em tempo real no dashboard e na página pública; km percorridos + restantes = comprimento da rota ± 1 %; localidades passam de próxima → atual → passada na ordem certa.
3. Sequência de avisos por voz exatamente a esperada, sem repetições, com ruído GPS e perda de sinal; continua sem rede.
4. DTO público não contém nenhum campo fora da lista branca (teste de esquema) e não mostra posição após entrega.
5. Limitação de taxa do `public-tracking` comprovada por teste.
6. Pré-visualização OG do link no WhatsApp mostra estado e rota (verificado com depurador OG; `VALIDADO (real)` só com um telemóvel real).
7. Nenhum ecrã mostra km, % ou ETA sem dados reais.
