import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Restrict to the __tests__ folder to avoid accidentally picking up other
    // test files in subdirectories. Using a more specific pattern helps avoid
    // surprising matches in large monorepos.
    include: ['__tests__/**/*.test.ts'],
  },
})
