import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      // `server-only` throws outside a React Server Components bundle; tests run plain Node.
      'server-only': root + 'tests/helpers/empty.ts',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: 'pglite:memory',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-test',
    },
  },
});
