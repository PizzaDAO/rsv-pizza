/// <reference types="vitest" />
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // forno-81402: iPhone 8 tops out at iOS 16 (Safari 16).
    target: ['es2020', 'safari15'],
  },
  server: {
    port: 5176,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_API_URL: 'http://localhost:3001',
      VITE_GOOGLE_MAPS_API_KEY: 'test-api-key',
    },
  },
});
