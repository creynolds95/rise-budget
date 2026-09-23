import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/budget/**/*.ts', 'src/networth/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/test-helpers.ts', 'src/budget/index.ts'],
      // SPEC gate for Phase 2: the engine is fully covered.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
