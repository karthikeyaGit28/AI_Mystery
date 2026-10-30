import pino from 'pino';
import { safeStartupCode } from './lifecycle.js';

const logger = pino({
  name: 'amr-worker',
  redact: ['key', 'apiKey', 'GEMINI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'prompt', 'blueprint'],
});
try {
  // Configuration parsing is inside the guarded import, so invalid environment
  // settings and failed startup checks never dump credentials or provider data.
  const { startWorker } = await import('./runtime.js');
  await startWorker(logger);
} catch (error) {
  logger.fatal({ errorCode: safeStartupCode(error) }, 'Worker startup failed');
  logger.flush();
  process.exit(1);
}
