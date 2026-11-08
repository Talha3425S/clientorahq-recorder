import { DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const uploadUrlLifetimeSeconds = 300;
const downloadUrlLifetimeSeconds = 3600;
let client;

function configuration() {
  const endpoint = process.env.SUPABASE_STORAGE_ENDPOINT?.trim().replace(/\/$/, '');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();
  const region = process.env.SUPABASE_STORAGE_REGION?.trim();
  const accessKeyId = process.env.SUPABASE_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    const error = new Error('Supabase Storage is not configured.');
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

function getClient(config) {
  if (!client) {
    client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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
    { expiresIn: uploadUrlLifetimeSeconds },
  );
  return { url, expiresIn: uploadUrlLifetimeSeconds };
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
  const url = await getSignedUrl(getClient(config), command, { expiresIn: downloadUrlLifetimeSeconds });
  return { url, expiresIn: downloadUrlLifetimeSeconds };
}

export async function deleteStoredObject(key) {
  const config = configuration();
  await getClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

export { downloadUrlLifetimeSeconds, uploadUrlLifetimeSeconds };
