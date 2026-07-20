import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: {
    port: 5173,
    https: {
      key: './certs/localhost-key.pem',
      cert: './certs/localhost.pem',
    },
    proxy: {
      '/api/admin/events': {
        target: 'https://localhost:8000',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
      '/api': {
        target: 'https://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/.well-known/mercure': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Désactiver tout buffering pour SSE
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Cache-Control', 'no-cache');
            proxyRes.headers['x-accel-buffering'] = 'no';
            proxyRes.headers['cache-control'] = 'no-cache';
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget.html'),
        embedEditor: resolve(__dirname, 'embed-editor.html'),
      },
    },
  },
});
