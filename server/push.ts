// Notificações push no navegador (Web Push + VAPID). Grátis, sem fornecedor externo pago.
// Configuração: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...). Sem chaves, o push fica desativado
// e a UI diz isso. Gerar chaves: npx web-push generate-vapid-keys
import webpush from 'web-push';
import type { Tx } from './db.js';

export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let configured = false;

export async function sendPushForAlerts(c: Tx, alertIds: string[]) {
  if (!pushConfigured() || !alertIds.length) return;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:suporte@example.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  const rows = (await c.query(`select a.id, a.title, a.detail, a.trip_id, s.endpoint, s.keys, s.id sub_id from alerts a
     join organization_members m on m.organization_id = a.organization_id and m.role in ('owner','admin','dispatcher')
     join push_subscriptions s on s.user_id = m.user_id and s.organization_id = a.organization_id
     where a.id = any($1)`, [alertIds])).rows;
  for (const r of rows) {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys },
        JSON.stringify({ title: r.title, body: r.detail ?? '', url: r.trip_id ? `/app/trips/${r.trip_id}` : '/app/alerts' }), { TTL: 3600 });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await c.query('delete from push_subscriptions where id = $1', [r.sub_id]);
    }
  }
}
