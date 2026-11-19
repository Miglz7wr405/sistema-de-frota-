# CLAUDE.md — insightFrota

> Este ficheiro é lido automaticamente pelo Claude Code em todas as sessões.
> Contém as regras permanentes do projeto. A especificação completa vive em `docs/SPEC.md`
> e as decisões técnicas em `docs/DECISOES.md`. Lê ambos antes de qualquer tarefa.

## Produto em uma frase

Plataforma SaaS de gestão e rastreamento de frotas para Moçambique, em que o diferencial é o cliente final acompanhar um camião por **código ou link, sem criar conta**, como se fosse uma encomenda.

**Princípio que decide qualquer dúvida:** um sistema poderoso por trás, extremamente simples para quem o utiliza.

## Stack (decidida, não mudar sem registar em `docs/DECISOES.md`)

- **Frontend: Vite puro (SPA estática), sem Next.js, sem SSR, sem servidor Node em produção** (ver ADR-000). Node.js só como ferramenta de desenvolvimento/build.
- **Bibliotecas do frontend:** Vite + React + TypeScript (strict) + Tailwind CSS + shadcn/ui + Lucide + React Router + TanStack Query + React Hook Form + Zod
- **Backend:** Neon Postgres (PostGIS) + API em Vercel Functions (`server/`, uma função) — ver ADR-014 a ADR-021. (O Supabase foi substituído.)
- **Mapas:** acesso apenas através da camada `src/lib/map/` (interface `MapProvider`). Nenhum componente importa o SDK do mapa diretamente.
- **GPS físico:** Traccar Server (servidor próprio) → `POST /api/ingest/traccar` → Postgres (porta única de ingestão: `server/ingest.ts`)
- **Testes:** Vitest (unidade + integração com Postgres/PostGIS real em `tests/api.test.ts`), Playwright (E2E)
- **Motorista:** PWA instalável (manifest + service worker), com fila offline em IndexedDB

## Regras de trabalho (obrigatórias)

1. **Uma fase de cada vez.** No fim de cada fase, para e entrega o relatório de fase (formato abaixo). Não avances sem a minha aprovação.
2. **Inspeciona antes de alterar.** Lê o código, o schema e as migrações existentes antes de mudar o que quer que seja. Não apagues funcionalidades sem justificação escrita.
3. **Não declares nada como concluído sem testar.** Usa sempre um destes três níveis, por extenso:
   - `IMPLEMENTADO`: código escrito, compila
   - `TESTADO (simulador/automático)`: testes a passar ou validado com o simulador GPS
   - `VALIDADO (real)`: validado com hardware ou telemóvel real em condições reais
4. **Nunca inventes dados.** Localização, distância, velocidade, ETA e progresso só são mostrados quando calculados a partir de dados reais. Sem dados → estado explícito ("Sem dados", "Localização desatualizada").
4b. **Distâncias são sempre rodoviárias**, calculadas pelo motor de rotas sobre a estrada, e o progresso é medido ao longo da rota planeada. Nunca linha reta, nunca km fixos no código. Localidades e províncias vêm da base `places`/`admin_areas` importada de fontes documentadas.
5. **Nunca inventes compatibilidade** com equipamentos GPS, APIs ou serviços. Se não foi testado, escreve que não foi testado.
6. **Dependências externas** (chaves de API, contas, hardware, custos) são assinaladas com `⚠️ DEPENDÊNCIA EXTERNA:` no código (comentário) e no relatório.
7. **Migrações SQL** sempre em `db/migrations/`, nunca alterações manuais ao schema. Cada migração é reversível ou explica porque não é.
8. Commits pequenos e descritivos, em português, por funcionalidade.

## Segurança (não negociável)

- RLS ativo em **todas** as tabelas do schema `public`. Tabela nova sem política RLS = tarefa não concluída.
- Isolamento por **organização** (`organization_id`), não por utilizador. Cada consulta privada é filtrada pela organização do membro autenticado.
- `service_role`, credenciais do Traccar, chaves de ingestão e segredos **nunca** no frontend nem no repositório. Usa `.env.local` (ignorado) e as variáveis de ambiente da Vercel.
- Visitantes anónimos **nunca** leem tabelas diretamente. A página pública só fala com `GET /api/track`, que devolve o DTO de lista branca (`public_trip_dto`).
- Documentos e fotografias **privados** (tabela `files` com RLS, ADR-017), servidos só a quem tem acesso, nunca por URL pública.
- Ações sensíveis (criar/revogar partilha, alterar permissões, apagar registos) ficam em `audit_logs`.
- Existe sempre um teste automático que prova que a organização A não lê, não altera e não apaga dados da organização B.

## Língua, local e formatos

- Interface em **português de Moçambique**: "camião/camiões" (não "caminhão"), "telemóvel", "matrícula", "carta de condução", "portagem".
- Moeda padrão **MZN** (formatar `1 250,00 MT`), com o campo `currency` preparado para outras moedas.
- Fuso horário `Africa/Maputo`. Guardar sempre `timestamptz` em UTC, mostrar na hora local.
- Telefones em formato E.164 (`+258…`).
- Todos os textos da UI em `src/i18n/pt-MZ.ts` (preparado para inglês no futuro). Nada de texto fixo nos componentes.

## Identidade visual

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#1769E8` | ações, links, percurso no mapa |
| `navy` | `#10243D` | sidebar, títulos |
| `background` | `#F5F7FA` | fundo das páginas |
| `surface` | `#FFFFFF` | cartões |
| `muted` | `#64748B` | texto secundário |
| `success` | `#16A36A` | "Em viagem", progresso, disponível |

Definir também `warning` (âmbar) e `danger` (vermelho) para alertas e manutenção, validando o contraste (WCAG AA).
Estilo: cartões simples, bordas de 1px discretas, raio de 12–16px, sombras mínimas, sem gradientes exagerados nem animações gratuitas. A única animação obrigatória é o movimento suave do camião no mapa.
Referências visuais em `docs/referencias/`. São inspiração, não para copiar pixel a pixel.

## Ligações de rede fracas (realidade do mercado)

- A página pública `/track/:code` tem de carregar bem em 3G e em telemóveis Android de gama baixa: bundle separado e mínimo, sem carregar o código da área administrativa.
- Todos os ecrãs têm os estados: a carregar, vazio, erro, sem ligação e dados desatualizados.

## Estrutura de pastas (alvo)

```
src/
  app/            # rotas e layouts (public, app, driver, platform)
  features/       # vehicles, drivers, trips, tracking, devices, alerts, costs, assistant
  components/ui/  # shadcn/ui e componentes base
  lib/            # api/, map/, geo/, format/, offline/
  i18n/
server/           # API (Vercel Function): rotas, auth, ingestão, rotas rodoviárias
db/
  migrations/     # SQL numeradas (aplicadas por npm run db:migrate ou /api/admin/migrate)
neon/functions/   # Neon Function de agendamento (jobs)
tests/            # integração (BD real, RLS A↔B)
tools/
  gps-simulator/  # simulador de posições (reproduz rotas reais)
docs/
  SPEC.md  DECISOES.md  MODELO-DADOS.md  FLUXOS.md  RISCOS-E-CUSTOS.md  PLANO.md
  referencias/
```

## Formato do relatório de fim de fase

```
## Relatório — Fase N
### Feito (com nível: IMPLEMENTADO / TESTADO / VALIDADO)
### Como testar (passos que eu consigo seguir)
### Testes automáticos (o que cobrem, resultado)
### ⚠️ Dependências externas pendentes
### Decisões tomadas (e registadas em DECISOES.md)
### Riscos e dívida técnica
### Proposta para a próxima fase
```

## Comandos

```
npm run dev            # API local (porta 3001) + Vite (porta 5173)
npm run build          # typecheck + vite build
npm run build:vercel   # build completo para a Vercel (.vercel/output)
npm test               # vitest (unidade); com TEST_DATABASE_ADMIN_URL também integração/RLS
npm run db:migrate     # DATABASE_URL=... aplica db/migrations
npm run sim -- --help  # simulador GPS
npm run import:places  # importa localidades OSM + limites HDX (precisa de internet)
```
Testes de integração: `TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost/postgres npm test` (Postgres 16 + PostGIS).
