# insightFrota

Gestão e rastreamento de camiões para Moçambique. O cliente final acompanha a carga por **código ou link, sem criar conta**.

- **Produção (Vercel):** https://insightfrota-miglz7wr-s-projects.vercel.app
- **Frontend:** Vite puro (SPA estática, 3 entradas: gestão `/`, público `/track`, motorista `/driver`) — sem Next.js.
- **API:** uma Vercel Function (`server/`), Node 22, região Frankfurt.
- **Base de dados:** Neon Postgres + PostGIS (projeto `insightfrota`, Frankfurt), RLS em todas as tabelas.
- Documentação: `docs/SPEC.md`, `docs/DECISOES.md` (ADR-000 a ADR-021), `docs/RELATORIOS.md`, `CLAUDE.md`.

## Começar a usar (produção)
1. Abrir o site → **Criar conta grátis** (cria a organização; fica como proprietário).
2. **Camiões** → adicionar camião. **Motoristas** → adicionar motorista → *Gerar link e PIN* → enviar o link por WhatsApp e dizer o PIN pessoalmente.
3. **Nova viagem** → origem/destino da base de localidades (OpenStreetMap) → a distância é calculada pela estrada.
4. No telemóvel, o motorista abre o link, introduz o PIN, aceita a partilha de localização e toca **Iniciar viagem** (manter a página aberta).
5. No detalhe da viagem → **Criar link para o cliente** → **WhatsApp** / **QR Code**.
6. Sem telemóvel no camião: **Dispositivos → Chaves de ingestão → Simulador GPS** e correr o simulador (abaixo).

## Desenvolvimento local
Requisitos: Node 22, Postgres 16 + PostGIS.
```bash
npm ci
```
```bash
DATABASE_URL=postgres://postgres:postgres@localhost/frota_dev npm run db:migrate
```
Criar `.env.local` com `DATABASE_URL` (papel `app_api`) e `SYSTEM_DATABASE_URL` (papel dono), depois:
```bash
npm run dev
```
Testes (unidade + integração com BD real, incluindo isolamento entre organizações):
```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost/postgres npm test
```

## Simulador GPS
```bash
npm run sim -- --base=https://insightfrota-miglz7wr-s-projects.vercel.app --key=<chave de simulador> --vehicle=<id do camião> --factor=60
```

## Variáveis de ambiente (Vercel)
`DATABASE_URL` (app_api, com RLS), `SYSTEM_DATABASE_URL` (dono; só servidor), `IP_SALT`, `JOBS_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
Opcionais: `ORS_API_KEY` (rotas OpenRouteService HGV), `RESEND_API_KEY` + `EMAIL_FROM` (recuperação de palavra-passe), `VITE_MAP_STYLE_URL`.

Mapas © OpenStreetMap contributors (ODbL).
