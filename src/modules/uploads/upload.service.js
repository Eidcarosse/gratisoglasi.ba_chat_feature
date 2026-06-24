/**
 * Layer: Service.
 * Upload business logic (doc §7): generate a presigned PUT URL for DO Spaces/S3 plus the final
 * object key, validating mime/size AT PRESIGN TIME. Bytes are uploaded by the client DIRECTLY
 * to Spaces — the droplet never handles the file. (Thumbnail generation is a later async job.)
 * Wraps the S3 client/presigner. If Spaces is not configured, presign throws 503.
 */
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config/index.js';
import { AppError } from '../../common/errors/AppError.js';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const URL_TTL_SECONDS = 300;

export class UploadService {
  constructor() {
    this.enabled = Boolean(config.SPACES_ENDPOINT && config.SPACES_BUCKET && config.SPACES_KEY);
    if (this.enabled) {
      this.client = new S3Client({
        endpoint: config.SPACES_ENDPOINT,
        region: config.SPACES_REGION,
        credentials: { accessKeyId: config.SPACES_KEY, secretAccessKey: config.SPACES_SECRET },
        forcePathStyle: false,
      });
    }
  }

  async presign({ userId, mime, size, filename }) {
    if (!this.enabled) throw AppError.unavailable('File uploads are not configured');
    if (!ALLOWED_MIME.has(mime)) throw AppError.validation(`Unsupported mime type: ${mime}`);
    if (size > MAX_SIZE) throw AppError.validation('File exceeds the 10MB limit');

    const ext = (filename?.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `chat/${userId}/${randomUUID()}${ext ? `.${ext}` : ''}`;

    const command = new PutObjectCommand({
      Bucket: config.SPACES_BUCKET,
      Key: key,
      ContentType: mime,
      ContentLength: size,
      ACL: 'public-read',
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: URL_TTL_SECONDS });
    return { url, key, expiresIn: URL_TTL_SECONDS };
  }
}

export default UploadService;
