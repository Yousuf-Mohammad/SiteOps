import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The `lint` script shipped with the starter but ESLint itself did not, so
 * `npm run lint` failed on a fresh clone. This is the minimum that makes it
 * meaningful: the recommended TypeScript rules, with the handful of
 * relaxations this codebase legitimately needs.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        NodeJS: 'readonly',
      },
    },
    rules: {
      // Nest's DI and Prisma's transaction client both need `any` at their
      // boundaries — audit.record(entry, tx as any) is the documented kernel
      // usage. Warn so new ones are visible without failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused args prefixed with _ are the Nest convention for required-but-
      // unused signature params (e.g. interceptor `_ctx`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests reach into response bodies that are genuinely untyped JSON.
    files: ['test/**/*.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
