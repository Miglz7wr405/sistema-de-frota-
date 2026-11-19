# Riscos e custos

> ⚠️ = valor ou facto **não confirmado**. Tem de ser verificado antes de qualquer compromisso comercial.

## 1. Riscos técnicos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | **GPS no navegador pára com o ecrã bloqueado / app em segundo plano** (sobretudo Android com poupança de energia agressiva e iOS). | Alta | Alto | Dizer a verdade na UI ("Mantenha esta página aberta"); Wake Lock; fila offline; indicador de estado; recomendar suporte de telemóvel com carregador no camião; app nativa (Capacitor + background geolocation) como fase futura; GPS físico (Fase 6) para clientes que precisam de garantia. |
| R2 | **Longos troços sem cobertura móvel** (ex.: EN1 entre Inchope e Caia ⚠️ a confirmar no terreno). | Alta | Médio | Fila offline; cálculo local de km/voz; a página pública mostra "Localização desatualizada" e nunca extrapola posição. |
| R3 | **Dados OSM incompletos** em Moçambique (estradas, nomes, pontos de referência). | Média | Alto | Validar o corredor Quelimane→Beira e Maputo→Xai-Xai antes do lançamento; locais privados da organização; contribuir correções para o OSM; aviso "rota não validada para pesados". |
| R4 | **Ruído GPS** em telemóveis baratos (precisão 50–500 m, saltos). | Alta | Médio | Filtros de precisão, saltos, monotonia, janelas de projeção; alertas com N posições consecutivas; testes com ruído no simulador. |
| R5 | **Relógio errado nos telemóveis** (L3). | Média | Médio | `received_at` + correção de desfasamento; frescura com hora do servidor. |
| R6 | **Adivinhação de códigos / abuso da página pública**. | Média | Alto | Código ~40 bits + token 128 bits; limitação de taxa por IP e por código; validade; revogação; logs de acesso; DTO de lista branca testado. |
| R7 | **Fuga de dados entre organizações** (erro de RLS). | Baixa | Crítico | RLS em todas as tabelas; testes A↔B automáticos em CI para cada tabela nova; revisão de segurança antes da produção. |
| R8 | **Crescimento de `vehicle_positions`**. | Média | Médio | Partições mensais, BRIN, retenção por plano, `trip_tracks` simplificado. |
| R9 | **Voz em português sem rede indisponível** em muitos aparelhos. | Média | Médio | Teste real na Fase 4; plano B com áudios pré-gerados (ADR-005). |
| R10 | **Pré-visualização OG no WhatsApp** depende do comportamento do crawler (redirecionamentos, cache). | Média | Baixo | `track-preview` devolve 200 com metatags (sem 3xx para o crawler); validar com telemóvel real. |
| R11 | **Operar Valhalla, Traccar e PMTiles** (servidores próprios) com equipa pequena. | Média | Médio | Uma VPS com Docker Compose, backups, monitorização simples (uptime + alertas); scripts reprodutíveis; plano B gerido (Stadia/MapTiler ⚠️). |
| R12 | **Limites do plano Supabase** (ligações Realtime, invocações de Edge Functions, tamanho da BD). | Média | Médio | Medir em `usage_counters`; polling na página pública; Broadcast por organização se necessário; rever plano antes de 100 viagens/dia. |
| R13 | **Legal: rastreamento de trabalhadores e proteção de dados** (L2). | Média | Alto | Rastrear só em viagem; consentimento registado; parecer jurídico ⚠️ antes do lançamento. |
| R14 | **Compatibilidade de equipamentos GPS** prometida sem teste. | Média | Alto | Nada é "compatível" sem estado `VALIDADO (real)`; plano de teste da secção 4. |

## 2. Serviços externos e custos estimados (mensais)

| Serviço | Para quê | MVP (≤ 20 camiões, ~10 viagens/dia) | 100 viagens/dia | 1000 viagens/dia | Confirmado? |
|---|---|---|---|---|---|
| Supabase | BD, Auth, Realtime, Storage, Edge Functions | Plano Free para desenvolvimento; **Pro ~25 USD** em produção (backups, sem pausa) | Pro + extras de computação ~50–100 USD | Plano maior / computação dedicada ~300–600 USD | ⚠️ preços a confirmar |
| Cloudflare Pages | Alojar a SPA | 0 USD | 0 USD | 0–20 USD | ⚠️ |
| Cloudflare R2 (PMTiles) | Tiles do mapa | < 1 USD | 1–5 USD | 5–20 USD | ⚠️ |
| VPS (Valhalla + Traccar) | Rotas para camiões, servidor GPS | 10–25 USD (4–8 GB RAM) | 25–50 USD | 80–150 USD (2 máquinas) | ⚠️ requisitos de memória a medir |
| Domínio `.co.mz` | Marca | ⚠️ preço e processo de registo a verificar | — | — | ⚠️ |
| TTS (só plano B de voz) | Áudios de avisos | ~0–10 USD | ~10–50 USD | ~50–300 USD | ⚠️ |
| SMS OTP (futuro) | Login do motorista | — | ⚠️ preço por SMS em Moçambique a cotar (Vodacom/Movitel/Tmcel ou agregador) | — | ⚠️ |
| WhatsApp Business API (futuro) | Notificações automáticas | — | ⚠️ preço por conversa para Moçambique a confirmar | — | ⚠️ |
| Cartões SIM de dados para GPS físico | Comunicação do dispositivo | ⚠️ ~1–3 USD/mês por SIM (pacote de dados pequeno) | — | — | ⚠️ cotar operadoras |
| Equipamento GPS | Hardware | ⚠️ 25–120 USD por unidade + instalação | — | — | ⚠️ |

Comparação de mapas para 10/100/1000 viagens/dia: ver ADR-001.

## 3. Só software vs exige hardware

| Funcionalidade | Só software (telemóvel/simulador) | Exige GPS físico |
|---|---|---|
| Gestão de frota, motoristas, documentos, viagens, custos | ✅ | — |
| Página pública, código, link, WhatsApp, QR | ✅ | — |
| Rastreamento durante a viagem | ✅ **com limitações** (R1): depende de o motorista manter o telemóvel ligado e a página aberta | Rastreamento contínuo e independente do motorista |
| Km percorridos/restantes, localidades, ETA, voz | ✅ (com posições do telemóvel) | Melhor continuidade |
| Rastreamento fora de viagem (camião parado no parque, uso indevido à noite) | ❌ (o telemóvel não envia fora de viagem, por privacidade) | ✅ |
| Ignição, quilometragem do veículo, corte de motor | ❌ | ✅ (conforme o modelo; corte de motor fora do âmbito) |
| Deteção de roubo / camião sem motorista | ❌ | ✅ |

## 4. Hardware GPS — o que se sabe e plano de teste

**Não foi testado nenhum equipamento.** O que segue é uma lista de candidatos a verificar, não uma lista de compatibilidade.

Famílias comuns em mercados africanos (presença em Moçambique ⚠️ por confirmar com fornecedores locais em Maputo e Beira), com o protocolo Traccar correspondente segundo a documentação do Traccar (⚠️ confirmar na versão instalada):

| Família (exemplos) | Protocolo Traccar | Notas |
|---|---|---|
| Teltonika FMB920 / FMB140 | `teltonika` | Bem documentado, entrada de ignição, preço médio-alto |
| Concox / Jimi GT06N, JM-VL01 | `gt06` | Muito comum e barato; qualidade variável entre clones |
| Queclink GV300 | `gl200` | Robusto, mais caro |
| Coban TK103 / TK303 e clones | `gps103` | Barato; muitos clones com firmware diferente |

Requisitos: SIM de dados 2G/4G (⚠️ confirmar se as redes 2G se mantêm ativas em Moçambique — importante para equipamentos só 2G), alimentação 12/24 V com fusível, ligação à ignição, instalação por técnico, APN configurado por SMS.

**Plano de teste (Fase 6), antes de qualquer promessa comercial:**
1. Comprar 1 Teltonika e 1 equipamento GT06 a fornecedores locais.
2. Bancada: configurar APN e servidor Traccar; validar receção, frequência, ignição, comportamento sem rede (memória interna e reenvio).
3. Campo: 1 semana num camião real em Quelimane→Beira; comparar com o telemóvel do motorista.
4. Só após isto o equipamento passa a `VALIDADO (real)` e entra na lista "testados" do site.
