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
      '/api': {
        target: 'https://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/.well-known/mercure': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
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
