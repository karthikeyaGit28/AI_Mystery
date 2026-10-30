import {
  assertQueueAvailable,
  closeQueues,
  connectDatabase,
  disconnectDatabase,
  s3,
  storage,
} from '@amr/server';

// Reuse server clients so the command also works after dev dependencies are pruned.
try {
  await connectDatabase();
  console.log('MongoDB: ready');
  await assertQueueAvailable();
  console.log('Redis: ready');
  await storage.checkBucket();
  console.log('Private media bucket: ready');
} catch {
  console.error(
    'Infrastructure check failed. Verify database access, queue availability, and private bucket settings.',
  );
  process.exitCode = 1;
} finally {
  const deadline = setTimeout(() => process.exit(process.exitCode ?? 1), 3000);
  deadline.unref();
  s3.destroy();
  await Promise.allSettled([closeQueues(), disconnectDatabase()]);
  clearTimeout(deadline);
  process.exit(process.exitCode ?? 0);
}
