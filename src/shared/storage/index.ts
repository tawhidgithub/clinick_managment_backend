import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';

/**
 * Private file storage for prescription photos (and later, the clinic logo).
 * Files are never public: clients get short-lived signed URLs.
 *   local - files on the server disk, served by GET /api/files/:token
 *   r2    - Cloudflare R2 (S3-compatible), presigned GET URLs
 */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

// ─── Signed tokens for local files ──────────────────────────────────────────

// Derived from the JWT secret so no extra secret needs configuring.
const fileSigningKey = createHmac('sha256', env.JWT_ACCESS_SECRET).update('chowa-file-urls').digest();
const sign = (payload: string) => createHmac('sha256', fileSigningKey).update(payload).digest('base64url');

export function createFileToken(key: string, ttlSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ k: key, e: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

/** Returns the storage key if the token is genuine and not expired, else null. */
export function verifyFileToken(token: string): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { k: string; e: number };
    if (typeof k !== 'string' || typeof e !== 'number' || e < Date.now() / 1000) return null;
    assertSafeKey(k);
    return k;
  } catch {
    return null;
  }
}

// ─── Drivers ────────────────────────────────────────────────────────────────

class LocalStorage implements StorageDriver {
  private readonly root = path.resolve(env.UPLOAD_DIR);

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Unsafe storage key: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async signedUrl(key: string, ttlSeconds = env.FILE_URL_TTL_SECONDS) {
    assertSafeKey(key);
    return `${env.PUBLIC_API_URL}/api/files/${createFileToken(key, ttlSeconds)}`;
  }
}

class R2Storage implements StorageDriver {
  private readonly client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  });
  private readonly bucket = env.R2_BUCKET!;

  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedUrl(key: string, ttlSeconds = env.FILE_URL_TTL_SECONDS) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}

export const storage: StorageDriver = env.STORAGE_DRIVER === 'r2' ? new R2Storage() : new LocalStorage();
export const isLocalStorage = env.STORAGE_DRIVER === 'local';
