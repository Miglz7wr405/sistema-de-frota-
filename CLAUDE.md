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
- **Backend:** Supabase (Postgres + PostGIS, Auth, Realtime, Storage, Edge Functions em Deno, pg_cron)
- **Mapas:** acesso apenas através da camada `src/lib/map/` (interface `MapProvider`). Nenhum componente importa o SDK do mapa diretamente.
- **GPS físico:** Traccar Server (servidor próprio) → Edge Function `ingest-position` → Postgres
- **Testes:** Vitest (unidade), Playwright (E2E), testes SQL para RLS (pgTAP ou scripts com utilizadores reais de teste)
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
7. **Migrações SQL** sempre em `supabase/migrations/`, nunca alterações manuais ao schema. Cada migração é reversível ou explica porque não é.
8. Commits pequenos e descritivos, em português, por funcionalidade.

## Segurança (não negociável)

- RLS ativo em **todas** as tabelas do schema `public`. Tabela nova sem política RLS = tarefa não concluída.
- Isolamento por **organização** (`organization_id`), não por utilizador. Cada consulta privada é filtrada pela organização do membro autenticado.
- `service_role`, credenciais do Traccar, chaves de ingestão e segredos **nunca** no frontend nem no repositório. Usa `.env.local` (ignorado) e os segredos das Edge Functions.
- Visitantes anónimos **nunca** leem tabelas diretamente. A página pública só fala com a Edge Function `public-tracking`, que devolve um DTO com lista branca de campos.
- Documentos e fotografias em buckets **privados**, servidos por URLs assinadas de curta duração.
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
  lib/            # supabase client, map/, geo/, format/, i18n
  i18n/
supabase/
  migrations/
  functions/      # ingest-position, public-tracking, driver-session, ...
  seed.sql
  tests/          # testes RLS
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

> Preencher na Fase 1 (dev, build, test, e2e, supabase start, db reset, gen types, simulador).
> Previsto: `npm run dev` (vite), `npm run build` (vite build), `npm run preview`, `npm test` (vitest), `npm run e2e` (playwright), `supabase start`, `supabase db reset`, `supabase gen types typescript --local`, `npm run sim`.
