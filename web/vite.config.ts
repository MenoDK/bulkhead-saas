import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.VITE_DEV_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev too: the SPA never needs CORS, exactly like behind the production nginx.
    proxy: {
      '/api': { target: api, changeOrigin: false, rewrite: (p) => p.replace(/^\/api/, '') },
      '/socket.io': { target: api, ws: true },
    },
  },
  build: { sourcemap: true, target: 'es2022' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
