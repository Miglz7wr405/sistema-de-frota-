import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { MIGRATIONS } from '../server/generated/migrations';
describe('migrações empacotadas', () => {
  it('server/generated/migrations.ts está igual a db/migrations (correr npm run gen:migrations)', () => {
    const files = readdirSync('db/migrations').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    expect(MIGRATIONS.map(([n]) => n)).toEqual(files);
    for (const [n, sql] of MIGRATIONS) expect(sql).toBe(readFileSync(`db/migrations/${n}`, 'utf8'));
  });
});
