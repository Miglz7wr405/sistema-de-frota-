import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tests/**/*.test.ts', 'tools/**/*.test.ts'], environment: 'node', testTimeout: 30000 },
});
