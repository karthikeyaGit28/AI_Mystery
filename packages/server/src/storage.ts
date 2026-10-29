import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { config } from './config.js';
export const s3 = new S3Client({
  endpoint: config.STORAGE_ENDPOINT,
  region: config.STORAGE_REGION,
  forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.STORAGE_ACCESS_KEY,
    secretAccessKey: config.STORAGE_SECRET_KEY,
  },
  requestHandler: { requestTimeout: 20_000, connectionTimeout: 5000 },
  maxAttempts: 3,
});
export const storage = {
  async putObject(key: string, body: Buffer | Uint8Array, mimeType: string) {
    if (body.byteLength > config.MAX_MEDIA_BYTES) throw new Error('MEDIA_TOO_LARGE');
    await s3.send(
      new PutObjectCommand({
        Bucket: config.STORAGE_BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  },
  getObject: (key: string, range?: string) =>
    s3.send(
      new GetObjectCommand({
        Bucket: config.STORAGE_BUCKET,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    ),
  async deleteObject(key: string) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }));
  },
};
export async function ensureStorageBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.STORAGE_BUCKET }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
      throw error;
    await s3.send(new CreateBucketCommand({ Bucket: config.STORAGE_BUCKET }));
  }
}
