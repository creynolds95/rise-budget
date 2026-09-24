import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.wrangler/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The budget engine is pure: no I/O, no clocks, no randomness.
    files: ['packages/shared/src/budget/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'Date', 'crypto', 'console'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random' },
        {
          object: 'Math',
          property: 'round',
          message: 'Use money.mulDiv — explicit integer rounding.',
        },
      ],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path'] }],
    },
  },
);
