import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './tests/test-env.mts';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: TEST_ENV,
    globalSetup: ['./tests/global-setup.mts'],
    // The API tests share one database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
