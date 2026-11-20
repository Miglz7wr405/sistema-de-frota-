// Sessão de motorista para o PRÓPRIO utilizador (o dono que é também o motorista da viagem, ou o teste com o telemóvel):
// sem link nem PIN, porque já está autenticado como membro. O consentimento é dado no botão que a pede (texto visível).
import { one, type Tx } from './db.js';
import { randomToken, sha256 } from './crypto.js';

export const CONSENT_VERSION = '2026-11';

export async function createOwnDriverSession(c: Tx, orgId: string, driverId: string, userId: string, why: string): Promise<string> {
  const token = randomToken(32);
  await c.query(`update driver_access set revoked_at = now() where driver_id = $1 and revoked_at is null`, [driverId]);
  const acc = await one<{ id: string }>(c, `insert into driver_access (organization_id, driver_id, token_hash, pin_hash, created_by)
    values ($1, $2, $3, '!sem-pin', $4) returning id`, [orgId, driverId, sha256(randomToken(32)), userId]);
  await c.query(`insert into driver_sessions (organization_id, driver_id, access_id, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '12 hours')`,
    [orgId, driverId, acc!.id, sha256(token)]);
  await c.query(`insert into driver_consents (organization_id, driver_id, consent_version, user_agent) values ($1, $2, $3, $4) on conflict do nothing`,
    [orgId, driverId, CONSENT_VERSION, why]);
  return token;
}
