import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { enqueue, flush, count, positionsCount, clear } from './queue';

describe('fila offline', () => {
  it('guarda por ordem, mantém tudo sem rede e envia por ordem quando a rede volta', async () => {
    await clear();
    await enqueue({ kind: 'action', method: 'POST', path: '/api/driver/trips/x/transition', body: { to: 'em_viagem' } });
    await enqueue({ kind: 'positions', body: { positions: [1, 2, 3] } });
    await enqueue({ kind: 'positions', body: { positions: [4] } });
    expect(await positionsCount()).toBe(4);
    // sem rede: nada sai
    expect(await flush(async () => 'retry')).toEqual({ sent: 0, left: 3 });
    const order: string[] = [];
    const r = await flush(async (it) => { order.push(it.kind); return 'ok'; });
    expect(r).toEqual({ sent: 3, left: 0 });
    expect(order).toEqual(['action', 'positions', 'positions']);
    expect(await count()).toBe(0);
  });
});
