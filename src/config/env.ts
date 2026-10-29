import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: booleanString.default(false),
  APP_TIMEZONE: z.string().default('Asia/Dhaka'),
  // Set to false on all but one instance if the API ever runs as several processes.
  RUN_JOBS: booleanString.default(true),
  // Number of reverse proxies (Nginx = 1) in front of the API, so req.ip is the
  // real client address. Default: 1 in production, 0 otherwise.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  // Requests per minute per IP across the whole API (0 = off). The clinic's
  // computers usually share one public IP, so keep this generous.
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(1200),

  // Public base URL of this API (used in signed links to uploaded files)
  PUBLIC_API_URL: z.string().url().optional(),
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  FILE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(3600),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

if (parsed.data.COOKIE_SAMESITE === 'none' && !parsed.data.COOKIE_SECURE) {
  console.error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  process.exit(1);
}

if (parsed.data.STORAGE_DRIVER === 'r2') {
  const missing = (['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const).filter(
    (k) => !parsed.data[k],
  );
  if (missing.length) {
    console.error(`STORAGE_DRIVER=r2 requires ${missing.join(', ')}`);
    process.exit(1);
  }
}

export const env = {
  ...parsed.data,
  PUBLIC_API_URL: (parsed.data.PUBLIC_API_URL ?? `http://localhost:${parsed.data.PORT}`).replace(/\/$/, ''),
  TRUST_PROXY: parsed.data.TRUST_PROXY ?? (parsed.data.NODE_ENV === 'production' ? 1 : 0),
};
export const isProduction = env.NODE_ENV === 'production';

// CORS_ORIGIN=* accepts every origin. Browsers reject a literal `*` on
// credentialed requests, so callers echo the request's origin back instead.
export const allowAnyOrigin = env.CORS_ORIGIN.includes('*');

export function isAllowedOrigin(origin: string): boolean {
  return allowAnyOrigin || env.CORS_ORIGIN.includes(origin);
}

// Settings that are fine on a laptop but unsafe on the live server.
if (isProduction) {
  const problems: string[] = [];
  if (/CHANGE_ME/i.test(env.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET is still the example value');
  if (/CHANGE_ME/i.test(env.DATABASE_URL)) problems.push('DATABASE_URL still has the example password');
  if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true (the API must be served over HTTPS)');
  if (problems.length) {
    console.error('Refusing to start in production:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (allowAnyOrigin) {
    console.warn('Warning: CORS_ORIGIN=* lets any website make signed-in requests; set the exact frontend origin');
  }
  if (env.CORS_ORIGIN.some((o) => o.includes('localhost'))) {
    console.warn('Warning: CORS_ORIGIN allows localhost in production');
  }
}
