import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    proxy: {
      '/api/errors/stream': {
        target: 'http://localhost:3000',
        // Disable buffering for SSE endpoint (F21 fix)
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['x-accel-buffering'] = 'no';
            proxyRes.headers['x-no-compression'] = 'true';
            proxyRes.headers['cache-control'] = 'no-cache';
            // Prevent http-proxy from buffering the SSE response
            delete proxyRes.headers['content-length'];
          });
        },
      },
      '/api': {
        target: 'http://localhost:3000',
      },
      '/health': {
        target: 'http://localhost:3000',
      },
    },
  },
});
