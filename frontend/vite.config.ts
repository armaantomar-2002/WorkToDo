/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only ever talks to the Node API (never to Python). In development Vite proxies /api to the backend, so the
// frontend and API share an origin and the HttpOnly refresh cookie "just works".
const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  preview: { port: 5173, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], css: false, include: ['src/**/*.test.{ts,tsx}'] },
});
