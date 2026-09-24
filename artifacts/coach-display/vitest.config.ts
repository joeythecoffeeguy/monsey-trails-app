import path from 'node:path';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // This standalone DevTools helper uses node:test, not the jsdom runner.
    exclude: [...configDefaults.exclude, 'scripts/driver-auth-regression.test.mjs'],
    environment: 'jsdom',
    restoreMocks: true,
    env: {
      VITE_MAPTILER_API_KEY: 'test-key',
    },
  },
});