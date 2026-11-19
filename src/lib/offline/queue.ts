// Fila offline (IndexedDB) da PWA do motorista. Uma só fila ORDENADA para posições e ações,
// para que "iniciar viagem" chegue ao servidor antes das posições dessa viagem.
// Sobrevive a fechar o navegador. Reenvio por ordem quando a rede volta.

export type QueueItem =
  | { kind: 'positions'; body: { sent_at?: string; positions: unknown[] } }
  | { kind: 'action'; method: string; path: string; body: unknown };
type Stored = QueueItem & { id?: number; createdAt: number; attempts: number };

const DB = 'insightfrota-driver';
const STORE = 'queue';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  }));
}

export const enqueue = (item: QueueItem) => tx('readwrite', (s) => s.add({ ...item, createdAt: Date.now(), attempts: 0 } as Stored));
export const all = () => tx<Stored[]>('readonly', (s) => s.getAll() as IDBRequest<Stored[]>);
export const remove = (id: number) => tx('readwrite', (s) => s.delete(id));
export const count = () => tx<number>('readonly', (s) => s.count());
export const clear = () => tx('readwrite', (s) => s.clear());
export async function positionsCount(): Promise<number> {
  return (await all()).reduce((n, it) => n + (it.kind === 'positions' ? it.body.positions.length : 0), 0);
}

export type Sender = (item: QueueItem) => Promise<'ok' | 'retry' | 'drop'>;

/** Envia por ordem; pára no primeiro erro de rede (mantém a ordem). Itens rejeitados de forma definitiva são descartados. */
export async function flush(send: Sender): Promise<{ sent: number; left: number }> {
  let sent = 0;
  for (const it of await all()) {
    const r = await send(it);
    if (r === 'retry') break;
    await remove(it.id!);
    if (r === 'ok') sent++;
  }
  return { sent, left: await count() };
}
