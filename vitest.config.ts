import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['.next/**', 'dist/**', 'node_modules/**'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
