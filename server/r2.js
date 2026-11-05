import { DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const urlLifetimeSeconds = 300;
const downloadUrlLifetimeSeconds = 3600;
let client;

function configuration() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    const error = new Error('Cloudflare R2 storage is not configured.');
    error.code = 'R2_NOT_CONFIGURED';
    throw error;
  }
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

function getClient(config) {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return client;
}

export async function createUploadUrl(key, contentType) {
  const config = configuration();
  const url = await getSignedUrl(
    getClient(config),
    new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
    { expiresIn: urlLifetimeSeconds },
  );
  return { url, expiresIn: urlLifetimeSeconds };
}

export async function verifyUploadedObject(key) {
  const config = configuration();
  const result = await getClient(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  return { sizeBytes: result.ContentLength, mimeType: result.ContentType };
}

export async function createDownloadUrl(key, filename) {
  const config = configuration();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename.replace(/[\r\n"\\/]+/g, '_').slice(0, 120) || 'recording'}"` } : {}),
  });
  const url = await getSignedUrl(
    getClient(config),
    command,
    { expiresIn: downloadUrlLifetimeSeconds },
  );
  return { url, expiresIn: downloadUrlLifetimeSeconds };
}

export async function deleteStoredObject(key) {
  const config = configuration();
  await getClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

export { urlLifetimeSeconds, downloadUrlLifetimeSeconds };
