import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/** Token aleatório (base64url). 16 bytes = 128 bits, 32 bytes = 256 bits. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Hash do IP com sal diário (os IPs não são guardados em claro). */
export function ipHash(ip: string) {
  const day = new Date().toISOString().slice(0, 10);
  return sha256(`${process.env.IP_SALT ?? 'insightfrota'}:${day}:${ip}`).slice(0, 32);
}

let dummy: string | null = null;
/** Hash válido para comparar quando o utilizador não existe (tempo de resposta igual). */
export const dummyHash = () => (dummy ??= bcrypt.hashSync('nao-existe', 10));
