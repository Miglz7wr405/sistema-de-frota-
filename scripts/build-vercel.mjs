// Build para a Vercel com a Build Output API v3 (controlo total, sem framework):
//  - estáticos do Vite em .vercel/output/static
//  - API empacotada (esbuild) numa única Node Function em .vercel/output/functions/api.func
//  - rotas: /api/* e /t/* → função; /track/* → track.html; /driver/* → driver.html; resto → index.html (SPA)
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npx vite build', { stdio: 'inherit' });
const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/static`, { recursive: true });
cpSync('dist', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['server/vercel-handler.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outfile: `${fn}/index.mjs`, loader: { '.sql': 'text' }, tsconfig: 'tsconfig.json', sourcemap: false, minify: false,
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 300, regions: ['fra1'] }, null, 2));
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));

const sec = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)' };
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '/(.*)', headers: sec, continue: true },
    { src: '/api/(.*)', dest: '/api' },
    { src: '/t/([A-Za-z0-9_-]+)/?', dest: '/api' },
    { handle: 'filesystem' },
    { src: '/track(/.*)?', dest: '/track.html' },
    { src: '/driver(/.*)?', dest: '/driver.html' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2));
console.log('Build Vercel pronto em .vercel/output');
