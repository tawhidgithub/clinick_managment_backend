// Runs once before all tests: brings the test database up to the latest
// migration, empties it, and seeds the base data (departments, services,
// plans, admin + frontdesk logins).
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseName, TEST_ENV } from './test-env.mts';

export default async function setup() {
  const env = { ...process.env, ...TEST_ENV };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });

  const prisma = new PrismaClient({ datasourceUrl: TEST_ENV.DATABASE_URL });
  try {
    const [{ db }] = await prisma.$queryRaw<[{ db: string }]>`SELECT current_database() AS db`;
    assertTestDatabaseName(db); // checked again on the live connection before emptying anything
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
    if (tables.length) {
      await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await prisma.$disconnect();
  }

  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });
  rmSync(TEST_ENV.UPLOAD_DIR, { recursive: true, force: true });
}
