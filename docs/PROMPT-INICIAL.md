# insightFrota — Prompt de arranque para o Claude Code

> Cola este prompt no Claude Code **em Plan Mode** (Shift+Tab até aparecer "plan mode").
> Antes, garante que tens na raiz do repositório: `CLAUDE.md` e as imagens de referência em `docs/referencias/`.

---

## 0. O teu papel e como vamos trabalhar

Assume o papel de **arquiteto de software sénior e engenheiro full-stack**, com experiência em SaaS multi-tenant, telemetria GPS, mapas, segurança e UX. Vais construir o **insightFrota** como produto comercial, não como demo.

Regras desta sessão:

1. **Nesta primeira tarefa não escreves código da aplicação.** Fazes apenas a **Fase 0 (Especificação)** descrita na secção 13 e paras.
2. Lê o `CLAUDE.md` (regras permanentes) e observa as imagens em `docs/referencias/` antes de começar.
3. Se o repositório já tiver código, inspeciona-o primeiro (estrutura, dependências, schema, migrações) e adapta o plano ao que existe.
4. Não repitas a minha especificação: **questiona-a**. A secção 3 já lista lacunas que identifiquei. Encontra outras.
5. Quando houver alternativas técnicas, **recomenda uma** com justificação (custo, complexidade, risco). Não me dês listas neutras.
6. Onde não tiveres a certeza (preços de APIs, compatibilidade de equipamentos, suporte de navegadores), diz que não tens a certeza e propõe como verificar. Pesquisa documentação oficial quando puderes.

---

## 1. O produto

**Nome:** insightFrota, "Sua frota sempre sob controlo".
**Mercado inicial:** Moçambique (rotas como Quelimane–Beira, Maputo–Xai-Xai, corredor da Beira, N1).
**Clientes iniciais:** proprietários individuais de camiões e pequenas transportadoras (1 a 20 veículos). Mais tarde, frotas grandes.
**Formato:** plataforma web responsiva + PWA para motoristas.

**O problema:** o dono de um camião não sabe onde o camião está, não controla bem os motoristas e passa o dia ao telefone a responder a clientes que perguntam "onde está a minha carga?".

**O diferencial:** cada viagem gera um **código e um link de rastreamento**. O dono envia-o ao cliente (sobretudo por **WhatsApp**) e o cliente vê o camião no mapa, o progresso e a chegada prevista, **sem conta e sem palavra-passe**. É a experiência de seguir uma encomenda.

---

## 2. Perfis de utilizador

| Perfil | Acesso | Notas |
|---|---|---|
| **Proprietário / Admin da organização** | Tudo da sua organização | Pode convidar outros membros |
| **Gestor / Despachante** | Operação (viagens, mapa, motoristas), sem faturação nem definições críticas | Novo perfil, essencial quando a empresa cresce |
| **Motorista** | Só as viagens que lhe foram atribuídas, via PWA | Não precisa de e-mail (ver secção 7) |
| **Cliente final** | Só a página pública de uma viagem | Sem conta |
| **Admin da plataforma (Insight)** | Área `/platform`: organizações, planos, utilização, suporte | Nunca vê dados operacionais sem registo em auditoria |

---

## 3. Correções e lacunas da especificação original (aplica-as)

1. **Multi-tenant por organização, não por `owner_id`.** Um dono pode ter sócios, gestores e despachantes. Usa `organizations` + `organization_members(role)`, com todas as tabelas privadas a terem `organization_id`. É isto que torna o SaaS possível.
2. **O código `FT-829461` é adivinhável.** São 6 dígitos, ou seja, 1 milhão de combinações, e um script percorre-as. Usa:
   - **código curto para ditar/digitar:** `FT-` + 8 caracteres Crockford Base32 (sem 0/O/1/I/L), por exemplo `FT-7K3M-9QXP` (cerca de 40 bits);
   - **link com token longo** (≥128 bits) para WhatsApp e QR Code;
   - limitação de tentativas por IP e por código, validade, revogação e registo de acessos.
3. **Ordem das fases errada.** Construir toda a interface antes do backend gera ecrãs falsos para deitar fora. Trabalha em **fatias verticais** (UI + BD + testes por funcionalidade) e põe o **rastreamento público no MVP**, porque é o que vende.
4. **Não há forma de testar GPS sem hardware.** Cria um **simulador GPS** (`tools/gps-simulator`) que reproduz rotas reais (Quelimane→Beira) com velocidade, paragens, perda de sinal e posições imprecisas, enviando pelo mesmo endpoint dos dispositivos reais.
5. **Uma só porta de entrada para posições.** Telemóvel, Traccar e simulador passam todos pela Edge Function `ingest-position`, que valida, deduplica, ordena e grava. Assim a lógica só existe num sítio.
6. **Realtime não deve transmitir o histórico.** O histórico de posições cresce muito depressa. A interface subscreve apenas `vehicle_latest_positions`. O histórico é consultado sob pedido.
7. **A página pública não pode usar Realtime sobre tabelas privadas.** Usa *polling* à Edge Function `public-tracking` (intervalo de 15–30 s, com cache curta), ou um canal Broadcast identificado pelo token. Recomenda uma das duas opções.
8. **Rotas para camiões.** O Google Maps não garante rotas de veículos pesados em Moçambique. Avalia o **Valhalla** (tem perfil `truck` com altura, largura, peso e eixos) em alojamento próprio ou num fornecedor gerido. Se não houver dados de restrições para a estrada, mostra o aviso "Rota sugerida, não validada para veículos pesados".
9. **Custos de mapas.** Com muitos utilizadores, abrir mapas (inclusive na página pública) custa dinheiro. Compara **Google Maps Platform** com **MapLibre GL + tiles OSM** (alojamento próprio ou fornecedor), e recomenda uma opção com uma estimativa de custo para 10, 100 e 1000 viagens/dia. A camada `MapProvider` permite trocar mais tarde.
10. **WhatsApp é o canal principal em Moçambique.** A partilha do link deve ter um botão "Enviar por WhatsApp" com mensagem pronta, e a página `/track/:token` deve ter metatags Open Graph (pré-visualização com estado da viagem). Notificações por WhatsApp/SMS ficam para mais tarde, mas a arquitetura de notificações deve prever esses canais.
11. **Documentos com validade são genéricos.** Carta de condução, seguro, inspeção, licença de transporte, manifesto: cria uma tabela `documents` (veículo ou motorista, tipo, número, validade, ficheiro), em vez de campos soltos.
12. **Associação dispositivo↔camião muda ao longo do tempo.** Guarda o histórico (`device_assignments` com `valid_from`/`valid_to`). Caso contrário, o histórico de posições fica atribuído ao camião errado.
13. **Estado do veículo é parcialmente derivado.** "Em viagem" vem da viagem ativa. "Parado" e "Sem sinal" vêm da telemetria. Define o que é guardado e o que é calculado, para não haver estados contraditórios.
14. **Linguagem:** em Moçambique diz-se "camião", não "caminhão". Usa português de Moçambique na interface.

Encontra pelo menos mais 5 lacunas e acrescenta-as ao `docs/SPEC.md`.

---

## 4. Módulos funcionais (âmbito)

**Dashboard:** total de camiões, em viagem, disponíveis, em manutenção, sem sinal; viagens em curso e concluídas; alertas. Mapa com a frota, viagens recentes e próximas, atividade recente, manutenções próximas e estado dos dispositivos. Atualização automática via Realtime.

**Camiões:** matrícula (única por organização), marca, modelo, ano, tipo, capacidade, peso bruto, dimensões (C×L×A), eixos, quilometragem, fotografia, documentos, estado, dispositivo associado. Página de detalhe com viagens, motorista habitual, última posição, manutenção e custos.

**Motoristas:** nome, telefone, fotografia, carta (número, categoria, validade), documentos, estado, histórico. Alertas de documentos a expirar (30/15/7 dias, configurável).

**Viagens:** camião, motorista, origem e destino (com coordenadas, via geocodificação ou marcação no mapa), pontos de passagem, partida e chegada previstas, mercadoria, peso, cliente/destinatário (nome e contacto **privados**), observações.
Estados: `planeada → aguardando_partida → em_viagem ⇄ pausada → concluida`, mais `cancelada`. **"Atrasada" não é um estado**: é um indicador calculado (ETA > chegada prevista + tolerância) que coexiste com "em viagem". Define a máquina de estados com transições permitidas e quem as pode fazer.
Linha do tempo de eventos: partida, paragens detetadas, chegada a pontos, ocorrências, alterações, comprovativo de entrega, chegada.

**Histórico:** pesquisa e filtros por período, camião, motorista, estado e cliente. Reprodução do percurso (*replay*) quando houver posições.

**Custos:** manutenção (tipo, data, km, custo, próxima por data **ou** km), combustível (litros, valor, km, posto, consumo calculado L/100 km), despesas de viagem (portagens, alimentação, alojamento, reparações, outras), com fotografia do recibo opcional. Resumos por camião, viagem e período, em MZN.

**Alertas e notificações:** ver secção 9.

**Assistente de viagem:** ver secção 10.

**Admin da plataforma:** organizações, planos, limites (n.º de camiões, dispositivos, retenção de histórico, partilhas ativas), utilização e suporte. Pagamentos ficam fora do MVP, mas `plans` e `subscriptions` existem desde o início, e os limites são verificados no backend.

---

## 5. Rastreamento GPS

### 5.1 Fontes
- **Telemóvel do motorista (PWA):** `navigator.geolocation.watchPosition` com consentimento explícito. Envia latitude, longitude, velocidade, rumo, precisão, timestamp do dispositivo e nível de bateria quando disponível.
  **Seja honesto na UI e na documentação:** no navegador, o rastreamento **pára ou degrada-se** com o ecrã bloqueado ou a app em segundo plano. Mitigações: Wake Lock API, aviso visível "Mantenha esta página aberta", fila offline em IndexedDB com reenvio. Propõe o caminho para uma app nativa (por exemplo, Capacitor com geolocalização em segundo plano) como fase futura, não como garantia atual.
- **Dispositivo GPS físico:** Dispositivo → Traccar → `ingest-position` → Postgres. Usa o encaminhamento de posições do Traccar (ou a sua API) e confirma o mecanismo exato na documentação da versão instalada. A autenticação é feita com uma chave de ingestão por organização, guardada como segredo.
- **Simulador:** mesmo endpoint, marcado como `source = 'simulator'`.

### 5.2 Hardware (não inventar)
Identifica os equipamentos mais comuns e acessíveis no mercado moçambicano e da África Austral, os protocolos que o Traccar suporta para eles, e requisitos como cartão SIM com dados (Vodacom, Movitel, Tmcel), alimentação, ignição e instalação. Propõe um **plano de teste com 1–2 equipamentos reais** antes de qualquer promessa comercial. Até lá, a integração tem o estado `IMPLEMENTADO`, nunca `VALIDADO`.

### 5.3 Ingestão (`ingest-position`)
- Validação com Zod; rejeitar coordenadas impossíveis, timestamps no futuro e saltos fisicamente impossíveis (velocidade implícita > limite).
- Deduplicação por (dispositivo, timestamp).
- Aceitar posições atrasadas (fila offline) sem que sobrescrevam uma posição mais recente em `vehicle_latest_positions`.
- Associar à viagem ativa do veículo naquele instante.
- Gravar no histórico e fazer *upsert* da última posição na mesma transação.
- Limitação de taxa por dispositivo.

### 5.4 Frescura da posição
Estados visíveis em toda a UI: **Atual** (< 2 min), **Desatualizada** (2–15 min), **Sem sinal** (> 15 min). Os limites são configuráveis por organização. Mostra sempre "última atualização há X min".

### 5.5 Intervalos
Em movimento, 10–30 s; parado, 1–5 min; configurável por organização e por dispositivo. No telemóvel, considera o consumo de bateria e de dados.

### 5.6 Volume e retenção
PostGIS (`geography(Point, 4326)`), particionamento mensal de `vehicle_positions`, índices (veículo + tempo; viagem + tempo; BRIN no tempo), retenção por plano com pg_cron e simplificação do percurso de viagens concluídas para o *replay*. Estima o volume: 1 camião × 1 posição/15 s × 10 h/dia × 30 dias.

---

## 6. Rastreamento público (diferencial principal)

**Rotas:** `/track` (formulário com o código) e `/track/:token` (link direto e QR).

**Fluxo:** o cliente introduz o código ou abre o link → `public-tracking` valida (existe, ativo, não expirado, não revogado, limite de taxa) → devolve **apenas** o DTO público → a página faz *polling* enquanto a viagem estiver ativa.

**DTO público (lista branca):** código, estado, origem e destino (nome da localidade), pontos de passagem relevantes, posição atual (lat/lng/rumo), frescura, percurso feito e por fazer, distância restante, % de progresso e ETA, **só quando calculáveis**. Opcional e configurável pelo dono: nome da empresa transportadora e logótipo, matrícula parcialmente oculta, primeiro nome do motorista.
**Nunca:** telefones, documentos, valores, dados de outros clientes, ID interno do veículo ou do motorista, histórico fora da viagem.

**Gestão da partilha (área privada):** gerar, copiar link, botão WhatsApp com mensagem pronta, QR Code (descarregar PNG), definir validade (por omissão: chegada + 48 h), desativar, revogar e regenerar, ver o n.º de acessos.

**Privacidade após a entrega:** depois de concluída a viagem, a página mostra "Entregue às HH:MM" e **deixa de mostrar a posição do camião**, que já pode estar noutra viagem.

**Design:** o mapa ocupa o ecrã. Cartão inferior com estado, barra de progresso verde, km restantes e chegada prevista. Sem menus. Inspira-te nas imagens em `docs/referencias/` (o cartão "Acompanhe a sua viagem" e o ecrã de telemóvel "FT-829461 / Em viagem / 62% concluído").

---

## 7. Experiência do motorista (PWA)

Muitos motoristas não usam e-mail. Recomenda e justifica um destes modelos:
- **A)** Link de acesso por motorista (token) + PIN de 4–6 dígitos definido pelo dono, revogável;
- **B)** Login por telemóvel com OTP por SMS (custo por SMS e fornecedor local a verificar).

A minha preferência inicial é **A** no MVP e **B** mais tarde. Confirma ou contraria.

Ecrãs do motorista, com botões grandes e o mínimo de texto: a minha viagem atual, iniciar viagem, pausar/retomar, reportar ocorrência (avaria, acidente, controlo policial, estrada cortada, outra) com foto opcional, chegar a ponto de passagem, entregar (foto, nome de quem recebeu, assinatura no ecrã), terminar viagem. Indicador permanente de "GPS a enviar / sem sinal / em fila (N posições por enviar)".
**Segurança rodoviária:** com o veículo em movimento, a interface reduz-se ao essencial e privilegia a voz.

---

## 8. Mapas

- Mapa ao vivo da frota com *clustering*, filtro por estado e seleção de veículo.
- Mapa de viagem: origem, destino, pontos de passagem, percurso **feito** (linha sólida azul) vs **restante** (linha mais clara ou tracejada), camião com ícone orientado pelo rumo e movimento interpolado suave entre posições.
- Distância percorrida e restante, velocidade e rumo quando existirem, ETA (ver abaixo).
- **ETA:** baseado na distância restante pela rota e na velocidade média recente realista, ou no serviço de rotas. Mostra "Chegada prevista ~16:40" apenas com dados suficientes; caso contrário, "Previsão indisponível". Nunca uma hora inventada.
- **Progresso:** distância percorrida ao longo da rota planeada ÷ distância total. Não usar distância em linha reta.

---

## 8A. Inteligência de percurso: localidades, distâncias e progresso ao vivo

Este é o "cérebro" do produto. O sistema tem de **conhecer Moçambique**: as províncias, as cidades, as vilas e os pontos de referência das estradas. Com isso, sabe em cada momento onde o camião está, quanto já percorreu, quanto falta e o que vem a seguir.

### 8A.1 Base geográfica de Moçambique
- Tabela `places` (PostGIS) com as **11 províncias** (polígonos), capitais provinciais, cidades, vilas e localidades ao longo das estradas nacionais. Inclui pontos de referência úteis ao motorista: pontes (por exemplo, a ponte sobre o Zambeze em Caia), portagens, postos de controlo, balanças, postos de combustível e fronteiras.
- Fonte dos dados: **OpenStreetMap** e limites administrativos oficiais (por exemplo, os do HDX/OCHA). Cria um script de importação reprodutível (`tools/import-places`) e documenta a fonte, a licença e a data dos dados. **Não escrevas localidades nem coordenadas à mão.**
- Campos: nome oficial e variantes de grafia (Xai-Xai/Chai-Chai), tipo, província, distrito, importância (para decidir o que anunciar) e geometria.
- O dono pode acrescentar os seus próprios locais, como armazéns, clientes, parques e oficinas. Estes ficam privados da organização.

### 8A.2 Distâncias entre localidades
- Ao criar uma viagem, o sistema calcula com o motor de rotas a **distância rodoviária real** e a duração estimada. Por exemplo: "Quelimane → Beira: X km, cerca de Y h por EN1/EN7". **Nunca usa linha reta nem números inventados.**
- Mostra a **lista de localidades por onde a rota passa**, cada uma com a distância desde a origem ("km 0 Quelimane… km N Nicoadala… km N Caia… km N Beira"). Funciona como um horário de comboio.
- Guarda em cache as rotas mais frequentes (`route_cache`), para poupar chamadas à API e mostrar a distância de imediato.
- Página ou ferramenta "Distâncias": o dono escolhe duas localidades e vê os km e o tempo. Serve para fazer orçamentos de frete.

### 8A.3 Progresso ao vivo (projeção na rota)
- Cada posição GPS é **projetada na geometria da rota planeada** (referenciação linear, por exemplo com `ST_LineLocatePoint`). Assim o sistema calcula:
  - **km percorridos** e **km restantes** ao longo da estrada, não em linha reta;
  - **% de progresso**;
  - **localidade atual**: "Em Nicoadala", "A 12 km de Caia" ou "Entre Mocuba e Alto Molócuè";
  - **província atual**, com o evento "Entrou na província de Sofala";
  - **próxima localidade** e o **ETA para cada localidade seguinte**, não só para o destino.
- Usa filtros contra ruído: ignora posições com má precisão, não deixa os km percorridos "andar para trás" por erro do GPS e suaviza a velocidade usada no ETA.
- **ETA inteligente**: combina a distância restante com a velocidade média recente do camião e com a velocidade típica de cada troço (aprendida com viagens anteriores). Mostra o grau de confiança e, quando é baixo, diz "Previsão aproximada".
- **Desvio da rota**: se o camião sair do corredor (com as regras da secção 9), recalcula a rota a partir da posição atual e regista o evento.
- Marca as localidades como **passadas** (com a hora real), **atual** e **próximas** (com a hora prevista).

### 8A.4 No mapa (dono e cliente)
- O camião avança de forma suave sobre o percurso. A linha feita é sólida e a linha por fazer é mais clara.
- Etiqueta junto ao camião: "Perto de Caia · faltam 180 km · 68 km/h".
- Painel lateral (no telemóvel, um painel que se arrasta para cima) com a **linha do tempo das localidades**: ✓ Quelimane 08:05 → ✓ Nicoadala 08:40 → ● agora perto de Mocuba → Caia ~14:10 → Beira ~16:40.
- A página pública do cliente mostra a mesma linha do tempo, simplificada: localidades principais, sem paragens nem velocidade.

### 8A.5 Avisos por voz e notificações por proximidade
Os avisos têm dois tipos de gatilho:
- **Por tempo**: "Faltam 15 minutos para Caia", "Faltam 5 minutos para Caia".
- **Por distância**: "Faltam 50 km para o destino", "Está a 10 km da Beira".
- **Por acontecimento**: "Está a entrar em Caia", "Passou por Nicoadala", "Entrou na província de Sofala", "Chegou ao destino".

Regras para não incomodar o motorista:
- Cada aviso toca **uma só vez** (com histerese: não repete se o camião oscilar à volta do limite).
- Intervalo mínimo entre avisos (por exemplo, 2 minutos), com prioridade para os mais importantes.
- Os avisos por tempo só tocam quando a confiança do ETA é suficiente. Caso contrário, usa o aviso por distância.
- Só anuncia localidades com importância suficiente. O dono configura o nível de detalhe (só cidades, ou também vilas e pontos de referência).
- O motorista pode silenciar os avisos, e há um registo dos avisos em `voice_announcements`.
- Os mesmos acontecimentos podem gerar notificações para o dono ("ADF 512 MP a 5 min da Beira") e atualizar a página do cliente.

### 8A.6 Funcionar sem rede
Nas estradas de Moçambique há longos troços sem cobertura. Ao iniciar a viagem, a PWA do motorista **descarrega a geometria da rota e as localidades do corredor**. Assim, o cálculo de km, a localidade atual e os avisos por voz funcionam **no telemóvel, a partir do GPS, mesmo sem internet**. As posições ficam em fila e são enviadas quando houver rede.
Verifica se a voz do navegador (`speechSynthesis`) em português funciona sem rede nos Android comuns. Se não funcionar, propõe uma alternativa: gerar os áudios dos avisos previsíveis no início da viagem (nomes das localidades da rota) com um serviço de TTS e guardá-los em cache.

### 8A.7 Testes obrigatórios
Com o simulador GPS, reproduz a viagem Quelimane→Beira e prova com testes automáticos que:
- os km percorridos e restantes batem certo com a distância da rota (tolerância definida);
- as localidades passam de "próxima" para "atual" e depois para "passada" na ordem certa;
- a sequência de avisos por voz é exatamente a esperada, sem repetições, incluindo com ruído GPS e perda de sinal;
- sem rede, o telemóvel continua a calcular e a anunciar.

---

## 9. Alertas e notificações

Tipos: início de viagem, chegada, chegada a ponto de passagem, sem comunicação GPS, atraso, desvio de rota, paragem anormal, manutenção próxima (data ou km), documento a expirar, dispositivo com problemas.

**Regras anti-falsos-positivos (obrigatórias):**
- **Desvio** apenas quando **N posições consecutivas** (por omissão 3) com precisão < X m estão fora de um corredor de Y m (por omissão 500 m) em torno da rota, durante pelo menos Z minutos.
- **Paragem anormal**: velocidade ≈ 0 dentro de um raio pequeno durante mais de T minutos, fora de pontos de passagem conhecidos.
- **Sem sinal**: com base na frescura (secção 5.4), com um só alerta por episódio.
- Cada alerta tem estados `aberto / reconhecido / resolvido` e não se repete enquanto aberto.

Canais: na app (Realtime) e push web no MVP; e-mail, SMS e WhatsApp preparados na arquitetura (`notification_channels`) para fases futuras. As regras são configuráveis por organização.

---

## 10. Assistente de viagem (copiloto por voz)

- **MVP:** os avisos por voz da secção 8A.5 (por tempo, por distância e por acontecimento), mais "Viagem iniciada" e "A localização deixou de ser atualizada".
- **Fase seguinte:** perguntas por voz ("Onde estou?", "Em que cidade estou?", "Quanto falta?", "Qual é a próxima cidade?", "Quanto falta para Caia?", "A que horas chego?") através de um botão grande "Falar". Primeiro com correspondência de intenções simples e local, sem LLM. Verifica e documenta o suporte de reconhecimento de voz em português nos navegadores Android, que é variável e pode exigir rede.
- **Regra de ouro:** o assistente responde **apenas** com dados calculados pelo sistema. Sem dados → "Não tenho essa informação neste momento."
- Sem conversas longas nem notificações em excesso durante a condução.

---

## 11. Modelo de dados (ponto de partida para melhorares)

Todas as tabelas com `id uuid`, `created_at`, `updated_at` (trigger), e `organization_id` quando forem privadas.

- **Conta e SaaS:** `organizations`, `organization_members` (user_id, role), `profiles`, `plans`, `subscriptions`, `usage_counters`
- **Frota:** `vehicles`, `drivers`, `documents` (polimórfico: veículo/motorista), `gps_devices` (IMEI único global, protocolo, modelo, último contacto), `device_assignments`
- **Operação:** `trips`, `trip_stops`, `trip_events`, `delivery_proofs`, `driver_access_tokens`
- **Telemetria:** `vehicle_positions` (particionada), `vehicle_latest_positions`, `ingest_keys`
- **Geografia e percurso:** `admin_areas` (províncias e distritos), `places` (localidades públicas e locais privados da organização), `route_cache`, `trip_routes` (geometria e comprimento da rota planeada e de cada recálculo), `trip_route_places` (localidade, km desde a origem, ordem, ETA, hora real de passagem), `trip_progress` (último km percorrido, localidade atual, ETA e confiança), `voice_announcements`
- **Partilha:** `tracking_shares` (código curto, hash do token, validade, revogação, opções de visibilidade), `tracking_access_logs`
- **Custos:** `fuel_records`, `maintenance_records`, `maintenance_schedules`, `trip_expenses`
- **Alertas:** `alert_rules`, `alerts`, `notifications`, `notification_channels`
- **Auditoria:** `audit_logs`

Guarda **o hash** dos tokens de partilha e de acesso do motorista, nunca o token em claro. Define as restrições `CHECK`, as chaves únicas compostas (por exemplo, matrícula + organização), as chaves estrangeiras com `ON DELETE` adequado e a política de eliminação lógica onde fizer sentido.

---

## 12. Rotas da aplicação

```
Público:     /  /login  /register  /forgot-password  /track  /track/:token
Organização: /app/dashboard  /app/live-map  /app/trips  /app/trips/:id
             /app/vehicles  /app/vehicles/:id  /app/drivers  /app/drivers/:id
             /app/devices  /app/alerts  /app/costs (manutenção, combustível, despesas)
             /app/reports  /app/settings (organização, membros, notificações, integrações)
Motorista:   /driver (entrar com link + PIN)  /driver/trip
Plataforma:  /platform/...
```

Navegação: sidebar azul-marinho no desktop e barra inferior com 4–5 itens no telemóvel. Ajusta se tiveres uma proposta melhor e justifica.

---

## 13. Fases (fatias verticais, cada uma com critérios de aceitação)

| Fase | Entrega | Critério de aceitação principal |
|---|---|---|
| **0. Especificação** | Documentos em `docs/` (ver abaixo) | Aprovados por mim |
| **1. Fundação** | Scaffold, design system, Supabase local, auth, organizações e membros, RLS base, CI, seeds | Teste prova que a org A não vê a org B; Lighthouse ≥ 90 na landing |
| **2. Frota** | Camiões, motoristas, documentos, upload privado | CRUD completo com validação, estados vazio/erro, alertas de validade calculados |
| **3. Viagens** | Criar/editar viagens, máquina de estados, eventos, histórico | Transições inválidas bloqueadas no backend; linha do tempo correta |
| **4. GPS + Mapa ao vivo + Inteligência de percurso** | `ingest-position`, PWA do motorista com fila offline, simulador, importação das localidades, distâncias, projeção na rota, km percorridos e restantes, localidade atual, ETA por localidade, avisos por voz básicos | Simulador Quelimane→Beira move o camião em tempo real; km e localidades corretos; avisos tocam na ordem certa e sem repetições; funciona sem rede |
| **5. Rastreamento público** | Partilhas, código + token, QR, WhatsApp, `public-tracking`, página pública | **Fim do MVP vendável.** Teste prova que o DTO não expõe campos privados; limitação de taxa funciona |
| **6. Traccar + hardware** | Servidor Traccar, dispositivos, associação por IMEI, estado de comunicação | `TESTADO` com simulador de protocolo; `VALIDADO` só com equipamento real |
| **7. Alertas e notificações** | Regras, motor de alertas, push web | Testes com trajetos simulados de desvio real vs ruído GPS (sem falsos positivos) |
| **8. Custos e relatórios** | Manutenção, combustível, despesas, relatórios | Totais por camião/viagem corretos e testados |
| **9. Assistente de voz** | Anúncios por voz e depois perguntas | Nunca responde com dados inexistentes (teste) |
| **10. Plataforma SaaS** | `/platform`, planos, limites | Limites aplicados no backend |
| **11. Produção** | Testes de carga da ingestão, segurança, backups, monitorização, domínio, documentação | Checklist de produção cumprida |

---

## 14. O que fazer AGORA (Fase 0)

Cria estes ficheiros e depois **pára**:

1. `docs/SPEC.md`: especificação oficial completa e melhorada (âmbito do MVP vs futuro, requisitos funcionais por módulo, requisitos não funcionais, critérios de aceitação).
2. `docs/DECISOES.md`: registo de decisões (ADR curto: contexto → decisão → alternativas → consequências). Inclui obrigatoriamente: fornecedor de mapas, motor de rotas para camiões, fonte dos dados de localidades e províncias, método de projeção na rota e de cálculo do ETA, voz sem rede, Realtime vs polling na página pública, modelo de acesso do motorista, formato do código de rastreamento e estratégia de particionamento.
3. `docs/MODELO-DADOS.md`: diagrama ER em Mermaid, tabelas com campos, tipos, restrições, índices e resumo das políticas RLS por tabela.
4. `docs/FLUXOS.md`: fluxos de cada perfil (dono, gestor, motorista, cliente e admin da plataforma) e o fluxo de uma posição GPS do dispositivo até ao ecrã do cliente (diagrama de sequência em Mermaid).
5. `docs/RISCOS-E-CUSTOS.md`: riscos técnicos com mitigação; serviços externos com custo estimado (marcando o que não foi confirmado); o que funciona **só com software** vs o que **exige hardware GPS**.
6. `docs/PLANO.md`: fases com tarefas, dependências, critérios de aceitação e estimativa relativa (P/M/G).

No fim, responde-me com:
- um resumo de 10 linhas das principais decisões;
- as lacunas novas que encontraste;
- **no máximo 10 perguntas** que precisam mesmo da minha resposta antes da Fase 1, cada uma com a tua recomendação já proposta.

Não comeces a Fase 1 sem eu escrever **"Aprovado, avança para a Fase 1"**.
