import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.mjs'],
    testTimeout: 60000,
    hookTimeout: 30000,
  }
});
