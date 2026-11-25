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

## Correções após o primeiro uso real (20/11)
O proprietário reportou: mapa não abre, GPS não funciona, "nenhum back-end funciona", faltam províncias. Causas encontradas
**num navegador real** (Playwright/Chromium), que antes não tinha testado:
1. **Gravações bloqueadas (403)** — a proteção CSRF comparava a origem do navegador com o host interno da Vercel; recusava
   todos os pedidos de gravação com sessão iniciada (criar camião, motorista, viagem…). Corrigido (Sec-Fetch-Site + anfitriões
   conhecidos) — **TESTADO** (teste unitário + E2E).
2. **Mapa invisível** — o CSS do MapLibre (`.maplibregl-map { position: relative }`) anulava a classe `absolute inset-0`; todos os
   mapas ficavam com 34 px de altura. Corrigido com posição em estilo direto, mais tempo limite de 10 s e mapa de reserva
   (OpenStreetMap raster) se o OpenFreeMap não carregar — **TESTADO** (E2E verifica altura > 200 px).
3. **GPS do telemóvel sem efeito** — a 1.ª posição (em cache no navegador) tinha hora anterior ao "Iniciar viagem" e ficava sem
   viagem associada. Tolerância de 2 min (migração 0014) — **TESTADO** (E2E com GPS emulado).
4. **Províncias** — passam a vir do geoBoundaries ADM1 (CC BY 4.0, origem OCHA COD-AB), importadas pelo job automático.
5. **Demonstração** — botão no painel que põe um camião do simulador a percorrer a rota real Quelimane → Beira (fonte "Simulador").
6. **Teste E2E** no repositório (`npm run e2e`): 14 passos em navegador real — registo, camião, motorista, link + PIN, viagem,
   GPS emulado, mapas, partilha, página pública, mapa ao vivo, demonstração. Resultado: **14/14**.

## Teste real com o telemóvel + camião na estrada (20/11, 2.ª ronda)
O proprietário rejeitou a demonstração com simulador e reportou que o ponteiro aparecia "do outro lado" (perto de Bulawayo).
1. **Ponteiro no sítio errado — causa encontrada e corrigida.** A posição na base de dados estava certa (34,09° E, −18,77° S). O erro
   estava no desenho: o elemento do marcador tinha `position: relative`, o que anulava o `position: absolute` do MapLibre e
   deslocava todos os marcadores. Corrigido, com ícone de camião visto de cima a rodar com o rumo real. **TESTADO** (E2E mede a
   diferença entre o marcador e a coordenada: 0,3 px / 0,5 px).
2. **Demonstração com simulador removida** (código e dados no Neon: 0 camiões, 0 viagens, 0 posições do simulador).
3. **"Testar com o meu telemóvel"** (`/app/self-test`): partida = posição GPS real, rota real, app do motorista no mesmo telemóvel,
   envio a cada 5 s. **TESTADO (automático)**: integração + E2E com GPS emulado. **VALIDADO (real): ainda não** (só o proprietário pode,
   com o telemóvel).
4. **Camião em cima da estrada, nome da estrada e limite (OSM)**: ver ADR-022. **TESTADO** com respostas de teste. O serviço real do
   Valhalla `trace_attributes` em produção: **não confirmado**.
5. **Velocidade real, a acelerar/a reduzir, km feitos, km que faltam, tempo ao ritmo atual, chegada prevista**: na app do motorista e no
   detalhe da viagem. **TESTADO (automático)**.
6. **Esquema do percurso** com curvas e localidades reais (ex.: Beira · Inchope · Gorongosa · Caia · … · Quelimane) no detalhe da viagem
   e na página do cliente. **TESTADO** (E2E).
- Testes: **50 a passar** (vitest, com integração em PostGIS real) + **E2E 14/14** em navegador real.

## Direto ao ponto (20/11, 3.ª ronda) — após o 1.º teste real do proprietário
**VALIDADO (real), parcialmente:** no teste do proprietário em Quelimane o GPS real chegou (precisão 1,8 m) e o ajuste à estrada do
Valhalla **funcionou em produção** ("25 de Setembro", ajuste ligado à posição exata). Essa via não tem `maxspeed` no OSM → "limite
desconhecido" (correto, nada inventado). Ainda não validado em movimento (só 4 posições, parado).
Queixa: "pergunta muito" e "não vejo o mapa nem o esquema com o camião". Feito:
1. **Teste com 1 toque**: painel → "Testar agora" → (permissão de localização só na 1.ª vez, do próprio Android) → viagem criada **já em
   viagem**, destino automático (localidade importante mais próxima, 15–150 km, rota real), sem telefone (migração 0016), sem ecrã de
   consentimento (frase no botão). "Mudar destino" e "Terminar teste" na app. **TESTADO** (integração + E2E).
2. **Motoristas reais**: link → PIN (mantido) → já está; o consentimento é uma frase no ecrã do PIN. **TESTADO** (E2E).
3. **App do motorista**: velocidade e limite no topo, depois **Percurso | Mapa**: esquema com as cidades da rota e o camião nos km
   feitos, ou mapa com a rota feita/por fazer e o camião em cima da estrada (segue o camião). **TESTADO** (E2E).
4. **Painel e mapa ao vivo**: esquema com o camião em cada viagem em curso; velocidade, estrada e limite no camião selecionado.
- Testes: **50** (vitest, com PostGIS real) + **E2E 16/16**.

## Registos diretos e mapa fixo (20/11, 4.ª ronda)
O proprietário não conseguia iniciar uma viagem ("Atribua um camião e um motorista") porque o registo do camião pedia muitos campos.
1. **Camião = matrícula, marca, modelo**; **motorista = nome e telefone**. Os outros campos ficam em "Mais detalhes (opcional)",
   fechados (nada foi apagado). Fonte GPS por omissão: telemóvel do motorista. **TESTADO** (E2E).
2. **"+ Novo" dentro da viagem**: cria o camião/motorista sem sair do formulário e já o escolhe; com 1 camião e 1 motorista ficam
   escolhidos sozinhos. Datas, carga e destinatário em "Mais detalhes". **TESTADO** (E2E 06b).
3. **Viagem sem camião/motorista**: cartão "Para iniciar, escolha…" com "Guardar e iniciar viagem" no próprio detalhe.
4. **Mapa da viagem fixo** (sem arrastar nem zoom), sempre enquadrado na rota inteira; volta a enquadrar se o ecrã mudar.
   **TESTADO** (E2E arrasta e roda a roda do rato: 0 px de diferença). A página do cliente mantém o mapa móvel (o painel de baixo
   cobre metade do ecrã).
5. **Esquema do percurso**: cada cidade ao lado do seu ponto, passadas a verde com a hora, próxima a azul com "faltam X km",
   "N km feitos · passou X" no topo e o camião a deslizar entre atualizações.
- Testes: **50** + **E2E 17/17**.

## Nova viagem só com o essencial (20/11, 5.ª ronda)
O formulário tinha "muita coisa sem interesse" e mostrou "Verifique os campos assinalados". Agora: **Origem, Destino, Camião (+ Novo),
Motorista (+ Novo: nome e telefone)** e **"Iniciar viagem agora"** (partida = agora) ou "Só guardar". Com 1 camião/1 motorista já vêm
escolhidos. Erros do servidor passam a dizer o campo. Os campos retirados continuam na API/BD (ADR-023). **TESTADO** (E2E 17/17, 50 testes).

## GPS a religar e mapa limpo (20/11, 6.ª ronda)
1. **"Ligar GPS novamente"** na app do motorista quando o GPS pára; o GPS também religa sozinho ao voltar à app (e há uma vigilância
   que o religa se ficar 45 s sem posição com a app aberta). No detalhe da viagem, se o motorista é o próprio utilizador (teste com o
   telemóvel) e está "Sem sinal": botão **"Reconectar o GPS deste telemóvel"**. **IMPLEMENTADO** (religar em aparelho real: por validar).
2. Retirada a mensagem "Rota sugerida, não validada para veículos pesados" (detalhe, distâncias, página do cliente).
3. Créditos do mapa (OpenFreeMap/OpenStreetMap) fechados no botão "i": a licença do OpenStreetMap obriga a que existam, mas deixam de
   tapar o mapa.
4. Iniciar viagem: um teste do telemóvel esquecido com o mesmo motorista/camião é terminado sozinho; criar+iniciar é uma só operação
   (sem viagens "Planeada" a mais se falhar); mensagem clara se o motorista/camião já está noutra viagem real. **TESTADO** (51 testes, E2E 17/17).

## Aviso "Já tem uma viagem em curso" (20/11, 7.ª ronda)
Ao iniciar uma viagem com um camião/motorista que já está noutra viagem em curso, aparece o aviso com a viagem em causa (código,
origem → destino) e a pergunta "Pretende cancelar essa viagem para iniciar esta?": **Cancelar essa viagem e iniciar esta** (motivo
"Substituída pela viagem FT-…"), **Essa viagem já chegou — concluir e iniciar esta**, ou **Voltar**. Tudo numa só transação, pela
máquina de estados (eventos e auditoria). Funciona em "Iniciar viagem agora", no botão "Iniciar viagem" e no cartão "Guardar e
iniciar". **TESTADO** (integração com isolamento A↔B; E2E 18/18; 51 testes).

## Ecrã do motorista mais limpo + voz em cada sítio (20/11, 8.ª ronda)
1. "← Voltar ao painel" no topo quando é o dono a testar com o telemóvel (motoristas reais só têm esta app: não aparece).
2. Retirado o botão "Falar" (reconhecimento de voz). "Mudar destino"/"Terminar teste" só no modo teste (E2E confirma que numa
   viagem real não aparecem).
3. Voz gratuita do telemóvel (speechSynthesis/Google-Android, sem ElevenLabs): "Está a entrar em X" agora também nas aldeias
   (importância ≥ 2), além de província, km para o destino e chegada. Voz masculina se o telemóvel tiver uma reconhecível pelo nome;
   senão a voz portuguesa disponível com tom mais grave. A voz ativa-se ao primeiro toque no ecrã (regra do Chrome).
   **TESTADO** (escolha da voz: 3 testes unitários; E2E). Som real no telemóvel: **por validar** pelo proprietário.
- Testes: 54 + E2E 18/18.

## Carga e responsável da carga (20/11, 9.ª ronda)
"Nova viagem" passa a ter, opcionais: **Carga**, **Responsável da carga** e **Telefone do responsável** (campos já existentes na BD:
`cargo_description`, `recipient_name`, `recipient_phone`; sem migração). Aparecem no detalhe da viagem (telefone com toque para ligar),
na app do motorista e na lista de viagens. Não aparecem na página pública do cliente (lista branca do DTO). **TESTADO** (55 testes, E2E 18/18).

## "Localização não aparece" — causa e correção (20/11, 10.ª ronda)
Dados reais (Neon): na viagem FT-ZC3Y-B442 (ADM 219 P, motorista = o proprietário) chegou só 1 posição (±200 m, localização
aproximada) às 14:24 e depois nada, porque o proprietário ficou no detalhe da viagem (painel), que não envia GPS; só a app do motorista envia.
1. Motorista = o próprio utilizador: "Iniciar viagem agora" abre logo o ecrã do motorista neste telemóvel com o GPS a enviar; no detalhe,
   com a posição não atual, botão "Usar o GPS deste telemóvel" (`POST /api/trips/:id/my-driver-session`, só para o próprio motorista,
   auditado). Motorista noutro telemóvel: aviso "o telemóvel do motorista não está a enviar" com atalho para lhe enviar o link.
2. Antes da 1.ª posição precisa: "Distância restante" mostra a distância da rota (rodoviária) com "rota completa — a aguardar GPS
   preciso"; posições imprecisas aparecem como "±200 m — a aguardar GPS preciso". Nada inventado.
**TESTADO** (56 testes; E2E 19/19, incl. viagem real com o motorista = utilizador a abrir o ecrã do motorista com GPS).

## Chegada automática, GPS automático, página do cliente organizada (20/11, 11.ª ronda)
1. **Conclusão automática**: quando o GPS real mostra o camião a ≤300 m do fim da rota, a viagem conclui-se sozinha (evento "chegada"
   do sistema, auditado). **TESTADO** (integração: percurso completo simulado → `concluida`).
2. **GPS automático**: motorista = o próprio utilizador → ao iniciar, e sempre que abre a viagem com a posição não atual, o ecrã do
   motorista abre sozinho e o GPS liga-se (sem botões "ligar/reconectar"; religa-se sozinho ao voltar à app). Botões de teste só em
   viagens de teste.
3. **Página do cliente no telemóvel**: cabeçalho, mapa fixo (não se arrasta) com a rota inteira, e por baixo "🚚 Agora: Em …",
   restantes, chegada e o esquema do percurso com o camião.
4. **Detalhe da viagem no telemóvel**: corrigido o conteúdo mais largo que o ecrã (link comprido e grelhas sem `minmax(0,1fr)`);
   retirada a lista repetida de localidades (o esquema do percurso já as mostra). **TESTADO** (E2E mede que nada passa da margem).
- Testes: 57 + E2E 20/20.

## Teste completo "um senhor regista a viagem e vai" (20/11, 12.ª ronda) — `bash scripts/e2e-viagem.sh`
Navegador real (Chromium como telemóvel e como computador), mesma API e site, Postgres/PostGIS local (o contentor não tem internet).
Rotas **reais** do Valhalla copiadas da produção (Quelimane→Beira 657,7 km; Quelimane→Nampula 547,2 km) e 133 localidades OSM reais.
GPS **emulado** ao longo da estrada real (início e fim em tempo real; o meio com as horas da viagem, como a fila offline).
Resultado final: **11/11 passos, 0 erros** (consola, páginas, respostas 5xx):
registo no telemóvel → viagem com "Eu próprio" + carga → ecrã do motorista abre e GPS liga sozinho → 72 km/h, km a avançar →
650,7 + 7,0 = 657,7 km (= rota) → localidades por ordem (Nicoadala→Caia→Gorongosa→Inchope→Dondo; "Portagem" 21→3) → no computador
o camião a 0,5 px da coordenada → reabrir no telemóvel liga o GPS sozinho → cliente: "Agora: A 4 km de Beira", mapa fixo → chega à
Beira e **conclui-se sozinha** → cliente vê "entregue" sem posição → Quelimane→Nampula concluída sozinha (Namacurra→Mocuba→Alto Molócue→Murrupula).
**Problemas reais encontrados e corrigidos** pelo teste: (1) não havia forma de dizer "o motorista sou eu" → opção "Eu próprio";
(2) 21 "Portagem" no mesmo sítio → agrupadas; (3) no computador o dono era mandado para o ecrã do motorista (sem GPS) → só no telemóvel;
(4) ao reabrir a app depois de horas fechada, o cálculo local ficava preso no ponto antigo → retoma na estrada e começa no ponto do servidor.
Não testado: GPS real com o ecrã bloqueado (limite do navegador), Maputo (sem rota real guardada), Valhalla de produção para rotas novas.

## Entrar na app = GPS ligado; "Agora / Já passou"; mapa do motorista fixo com zoom automático (20/11, 13.ª ronda)
- No telemóvel, ao entrar na app com uma viagem em curso em que o motorista é o próprio utilizador, abre-se sozinho o ecrã do
  motorista e o GPS liga-se (sem botões). "Voltar ao painel" deixa ficar no painel até fechar a app.
- Ao reabrir: "📍 Agora: A 7 km de Beira · Já passou por Manga" logo à entrada (do servidor, antes de andar); o mesmo na página de
  quem procura pelo código ("Agora: … · Já passou por … às HH:MM").
- Viagens entre quaisquer províncias: as 11 províncias e as suas cidades estão na base (1573 localidades); nada limita a origem/destino.
- Mapa do motorista: primeiro "Mapa", depois "Percurso"; fixo (não se arrasta nem faz zoom); mostra a rota inteira; aproxima sozinho
  (animação de 2,5 s) ao chegar a uma cidade/vila (5 min) e de 10 em 10 min (1 min), depois volta à rota inteira.
**TESTADO**: 59 testes; E2E 20/20; viagem completa 11/11 (mapa: rota inteira 238 px → aproximado ao chegar à Beira).

## Relatório — Polimento de lançamento (25/11)
### Feito
- **TESTADO** (Playwright em telemóvel):
  - página 404 pública e no painel;
  - `/termos` e `/privacidade`, sem scroll lateral, com o WhatsApp +258 86 727 2348;
  - rodapé com © 2026, Termos, Privacidade e Contacto;
  - erro forçado em /track mostra "Algo correu mal · Recarregar", sem ecrã branco.
- **TESTADO:**
  - `index.html` com og:url, og:locale, twitter:card, canonical e og:image absoluto;
  - `robots.txt` e `sitemap.xml` presentes;
  - título "A sua frota sempre sob controlo" (pt-MZ).
- **TESTADO:** a página do cliente ficou mais leve, de 66 para 56 KB de JS gzip antes do mapa (medido no `dist`).
- **IMPLEMENTADO:**
  - textos que faltavam passaram para o i18n (Definições, navegação, custos, WhatsApp);
  - ganchos de teste do mapa fora da produção;
  - fim do aviso de SSL do pg;
  - logótipo "insightFrota" sem espaço a mais (login, painel, cliente, landing).
### Testes automáticos
- 72/72 (vitest com Postgres/PostGIS), incluindo o isolamento A↔B.
- E2E `scripts/e2e.sh`: todos os passos passaram.
### ⚠️ Dependências externas pendentes
- Números M-Pesa/e-Mola e o teste de 1 MT.
- Licença comercial do áudio ElevenLabs.
- Domínio próprio, se o quiser; hoje o site está em insightfrota.vercel.app.
