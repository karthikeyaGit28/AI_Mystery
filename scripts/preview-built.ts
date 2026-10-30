import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Import server modules only after establishing this isolated smoke-test environment.
// This preview never imports server.ts or calls connectDatabase / queue readiness.
const port = 4187;
const origin = `http://localhost:${port}`;
const webDistPath = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
Object.assign(process.env, {
  NODE_ENV: 'test',
  AI_MODE: 'mock',
  GEMINI_API_KEY: '',
  PORT: String(port),
  HOST: '127.0.0.1',
  SERVE_WEB: 'true',
  WEB_DIST_PATH: webDistPath,
  WEB_ORIGIN: origin,
  API_BASE_URL: origin,
  RENDER_EXTERNAL_URL: origin,
  TRUST_PROXY_HOPS: '0',
  SESSION_SECRET: 'hosting-smoke-test-only-no-real-player-sessions',
  MONGODB_URI: 'mongodb://127.0.0.1:1/unused_hosting_smoke',
  REDIS_URL: 'redis://127.0.0.1:1',
  STORAGE_ENDPOINT: 'http://127.0.0.1:1',
  STORAGE_ACCESS_KEY: 'unused-hosting-smoke',
  STORAGE_SECRET_KEY: 'unused-hosting-smoke',
});

if (!existsSync(new URL('../apps/web/dist/index.html', import.meta.url))) {
  throw new Error('The hosting smoke preview needs the built frontend. Run npm run build first.');
}

const { createApp } = await import('../apps/api/src/app.js');
const app = createApp({ serveWeb: true, webDistPath, trustProxyHops: 0 });
const server = app.listen(port, '127.0.0.1', () => {
  console.log(
    `Built frontend smoke preview: ${origin} (no database, queue, or provider connection)`,
  );
});

server.on('error', (error) => {
  console.error('Built frontend preview could not start:', error.message);
  process.exitCode = 1;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 5_000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      console.error('Built frontend preview shutdown failed:', error.message);
      process.exitCode = 1;
    }
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
