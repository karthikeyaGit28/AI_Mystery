import { MongoClient } from 'mongodb';
import { Redis } from 'ioredis';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '@amr/server';

const mongo = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: () => null,
});
const s3 = new S3Client({
  endpoint: config.STORAGE_ENDPOINT,
  region: config.STORAGE_REGION,
  forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.STORAGE_ACCESS_KEY,
    secretAccessKey: config.STORAGE_SECRET_KEY,
  },
});
try {
  await mongo.connect();
  await mongo.db().command({ ping: 1 });
  console.log('MongoDB: ready');
  await redis.connect();
  await redis.ping();
  console.log('Redis: ready');
  await s3.send(new HeadBucketCommand({ Bucket: config.STORAGE_BUCKET }));
  console.log('Private media bucket: ready');
} catch (error) {
  console.error(
    'Infrastructure check failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
} finally {
  await mongo.close();
  redis.disconnect();
  s3.destroy();
}
