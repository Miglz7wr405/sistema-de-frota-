// npm run import:places — corre a importação a partir de uma máquina com internet.
// Requer SYSTEM_DATABASE_URL (papel dono). Ordem: províncias primeiro, depois localidades.
import pg from 'pg';
import { importPlaces, importProvinces } from './core.js';

const url = process.env.SYSTEM_DATABASE_URL;
if (!url || process.argv.includes('--help')) {
  console.log('Uso: SYSTEM_DATABASE_URL=postgres://... npm run import:places\nImporta províncias e localidades de Moçambique do OpenStreetMap (Overpass).');
  process.exit(url ? 0 : 1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  console.log(await importProvinces(c));
  console.log(await importPlaces(c));
} finally { await c.end(); }
