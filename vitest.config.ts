import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/api/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/api/src/**/__tests__/**/*.test.ts'],
    globals: true,
  },
});
