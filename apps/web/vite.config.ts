import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000' },
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../../packages/shared', import.meta.url)),
        fileURLToPath(new URL('../../node_modules', import.meta.url)),
      ],
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/packages/server/**',
        '**/apps/api/**',
        '**/apps/worker/**',
        '**/@amr/server/**',
        '**/@amr/api/**',
        '**/@amr/worker/**',
      ],
    },
  },
  build: { sourcemap: false },
});
