import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import testFlakinessPlugin from 'eslint-plugin-test-flakiness';
import playwright from 'eslint-plugin-playwright';
import compat from 'eslint-plugin-compat';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/', '**/node_modules/', '**/.turbo/', '**/build/'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    plugins: { 'test-flakiness': testFlakinessPlugin },
    rules: {
      'test-flakiness/no-random-data': 'warn',
      'test-flakiness/no-hard-coded-timeout': 'warn',
      'test-flakiness/no-global-state-mutation': 'warn',
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['e2e/**/*.spec.ts', 'e2e/**/*.test.ts'],
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    plugins: { compat },
    rules: {
      'compat/compat': 'warn',
    },
  },
);
