// Cliente HTTP da SPA. A SPA só fala com /api (mesma origem). Nunca com a BD diretamente.
import { t } from '@/i18n/pt-MZ';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) { super(code); }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; bearer?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'rede');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'erro', (data as { details?: unknown } | null)?.details);
  return data as T;
}

/** Mensagem legível (pt-MZ) para um erro da API. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return t.errors.generic;
  if (e.status === 0) return t.errors.network;
  const map: Record<string, string> = {
    nao_autenticado: t.errors.unauthorized, sem_permissao: t.errors.forbidden, duplicado: t.errors.conflict, email_existente: t.errors.emailTaken,
    validacao: t.errors.validation, dados_invalidos: t.errors.validation, demasiados_pedidos: t.errors.rateLimited,
    transicao_invalida: t.errors.invalidTransition, limite_plano: t.errors.planLimit, viagem_sem_camiao_ou_motorista: t.errors.tripNoAssets,
    motivo_obrigatorio: t.errors.reasonRequired, ultimo_owner: t.errors.lastOwner, credenciais_invalidas: t.errors.invalidCredentials,
    rota_indisponivel: t.errors.routeUnavailable, precisao_insuficiente: t.selftest.poorAccuracy, ficheiro_grande: t.errors.fileTooLarge, corpo_grande: t.errors.fileTooLarge,
  };
  return map[e.code] ?? t.errors.generic;
}

/** Comprime uma imagem no navegador (máx. 1600 px, JPEG) e devolve base64 — poupa dados móveis e espaço. */
export async function fileToUpload(file: File | Blob, maxSide = 1600): Promise<{ contentType: string; dataBase64: string }> {
  if (file.type === 'application/pdf') return { contentType: 'application/pdf', dataBase64: await toB64(file) };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.75));
  return { contentType: 'image/jpeg', dataBase64: await toB64(blob) };
}
async function toB64(b: Blob) {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
