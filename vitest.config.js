import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Restrict to the __tests__ folder to avoid accidentally picking up other
    // test files in subdirectories.
    include: ['__tests__/**/*.test.ts'],
    globals: true,
  },
})
