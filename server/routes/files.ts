// Ficheiros privados (fotografias, documentos, recibos, assinaturas). Servidos só a quem tem acesso (RLS),
// nunca por URL pública. Limite 2 MB (as imagens são comprimidas no navegador antes do envio).
import { z } from 'zod';
import { route, ok, parse, HttpError, assertUuid, type Req } from '../http.js';
import { one } from '../db.js';
import { getMember, getDriver, asMember, asDriver, WRITE } from '../auth.js';

const FileSchema = z.object({
  kind: z.enum(['vehicle_photo', 'driver_photo', 'document', 'receipt', 'delivery_photo', 'signature', 'incident_photo', 'logo']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(10).max(2_900_000),
});

function decode(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'ficheiro_grande');
  return buf;
}
function sniff(buf: Buffer, ct: string) {
  const sig = buf.subarray(0, 4).toString('hex');
  const okSig = (ct === 'image/jpeg' && sig.startsWith('ffd8')) || (ct === 'image/png' && sig === '89504e47')
    || (ct === 'image/webp' && buf.subarray(8, 12).toString() === 'WEBP') || (ct === 'application/pdf' && buf.subarray(0, 4).toString() === '%PDF');
  if (!okSig) throw new HttpError(400, 'tipo_ficheiro_invalido');
}

async function upload(req: Req) {
  const b = parse(FileSchema, req.body);
  const data = decode(b.dataBase64);
  sniff(data, b.contentType);
  const m = await getMember(req);
  if (m?.orgId && m.role && WRITE.includes(m.role)) {
    return asMember(m, (c) => one(c, `insert into files (organization_id, kind, content_type, size_bytes, data, created_by)
      values ($1,$2,$3,$4,$5,$6) returning id`, [m.orgId, b.kind, b.contentType, data.length, data, m.userId]));
  }
  const d = await getDriver(req);
  if (d && !d.revokedAt) {
    return asDriver(d, (c) => one(c, `insert into files (organization_id, kind, content_type, size_bytes, data, created_by)
      values ($1,$2,$3,$4,$5,$6) returning id`, [d.orgId, b.kind, b.contentType, data.length, data, d.driverId]));
  }
  throw new HttpError(401, 'nao_autenticado');
}

route('POST', '/api/files', async (req) => ok(await upload(req), 201));
route('POST', '/api/driver/files', async (req) => ok(await upload(req), 201));

route('GET', '/api/files/:id', async (req, p) => {
  const id = assertUuid(p.id);
  const q = 'select content_type, data from files where id = $1';
  const m = await getMember(req);
  let f: { content_type: string; data: Buffer } | null = null;
  if (m?.orgId) f = await asMember(m, (c) => one(c, q, [id]));
  else {
    const d = await getDriver(req);
    if (d) f = await asDriver(d, (c) => one(c, q, [id]));
  }
  if (!f) throw new HttpError(404, 'nao_encontrado');
  return { status: 200, raw: f.data, headers: { 'content-type': f.content_type, 'cache-control': 'private, max-age=300' } };
});
