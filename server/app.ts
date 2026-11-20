// Regista todas as rotas da API (importado pela Vercel Function e pelo servidor local).
import './routes/auth.js';
import './routes/org.js';
import './routes/files.js';
import './routes/fleet.js';
import './routes/trips.js';
import './routes/ingest.js';
import './routes/driver.js';
import './routes/public.js';
import './routes/misc.js';
import './routes/ops.js';
import './routes/costs.js';
import './routes/platform.js';
export { dispatch } from './http.js';
import './routes/admin.js';
import './routes/selftest.js';
