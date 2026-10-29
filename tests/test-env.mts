// Environment for the test run. Tests use their own database so they can
// empty it freely: TEST_DATABASE_URL, or DATABASE_URL with "_test" added to
// the database name (chowa_clinic -> chowa_clinic_test).
import os from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';

config({ quiet: true });

function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) in .env to run the tests');
  const url = new URL(base);
  if (!explicit) url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  return url.toString();
}

/** The tests empty this database, so it must be clearly a test database. */
export function assertTestDatabaseName(name: string) {
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": the database name must end with _test`);
  }
}

const databaseUrl = testDatabaseUrl();
assertTestDatabaseName(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)));

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: 'test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  CORS_ORIGIN: 'http://localhost:3000',
  COOKIE_SECURE: 'false',
  COOKIE_SAMESITE: 'lax',
  APP_TIMEZONE: 'Asia/Dhaka',
  RUN_JOBS: 'false',
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: path.join(os.tmpdir(), 'chowa-test-uploads'),
  PUBLIC_API_URL: 'http://localhost:4999',
  SEED_ADMIN_USERNAME: 'admin',
  SEED_ADMIN_PASSWORD: 'Test-Admin-2026',
};
