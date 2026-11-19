// Neon Function "jobs": invocada por triggers de agenda (cron) e chama a API da Vercel.
// Sem dependências (só fetch). Variáveis: JOBS_URL (https://<app>/api/jobs/run), JOBS_SECRET.
const handler = {
  async fetch(request) {
    const kind = new URL(request.url).pathname.includes('daily') ? 'daily' : 'periodic';
    const r = await fetch(`${process.env.JOBS_URL}?kind=${kind}`, { method: 'POST', headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
  },
};
export default handler;
