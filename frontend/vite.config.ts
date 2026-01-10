import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/rsv-pizza/',
  server: {
    port: 5176,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
