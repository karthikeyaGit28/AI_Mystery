import { createApp } from './app.js';
import {
  connectDatabase,
  disconnectDatabase,
  closeQueues,
  config,
  ensureStorageBucket,
  s3,
} from '@amr/server';
import pino from 'pino';
const logger = pino();
await connectDatabase();
await ensureStorageBucket();
const app = createApp();
const server = app.listen(config.PORT, () =>
  logger.info({ port: config.PORT, aiMode: config.AI_MODE }, 'AI Mystery Room API ready'),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await closeQueues();
    await disconnectDatabase();
    s3.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
