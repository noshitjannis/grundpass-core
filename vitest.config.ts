import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: process.env.LIVE ? [] : ['test/live/**'],
    testTimeout: process.env.LIVE ? 30_000 : 10_000,
  },
});
