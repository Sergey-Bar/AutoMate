import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import {
  FOCUSED_TEST_PROPERTY_SET,
  SKIPPED_TEST_IDENTIFIER_SET,
  SKIPPED_TEST_PROPERTY_SET,
} from './scripts/disabled-tests.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.kilo/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@automate/db', '@automate/auth', 'drizzle-orm', 'pg'],
              message: 'Web code must use browser-safe contracts and API boundaries.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared-contracts/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['hono', 'react', 'drizzle-orm', 'pg', '@automate/*'],
              message: 'Shared contracts must remain runtime-agnostic and dependency-free.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', 'perf/**/*.{js,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // SonarQube's own rule catalogue, running locally (decision D2).
    //
    // `cognitive-complexity` is **off for now, and that is a recorded decision,
    // not an oversight.** 31 existing functions exceed 15, the worst at 75 and
    // 71 — the two largest files, which Q0.14 splits. Turning it on as an error
    // today would fail `pnpm lint` on code nobody is touching, and the realistic
    // outcome of a permanently red lint gate is that it gets switched off, taking
    // the other two rules with it. It becomes an error as part of the Q0.14
    // split, and `docs/quality/debt-baseline.json` records the current offenders
    // so the ceiling can only ratchet down from there.
    //
    // The other two are hard errors from day one: they are mechanical
    // simplifications with no judgement involved, and the tree passes both.
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-redundant-jump': 'error',
      // Two runners that legitimately do the same thing is the pattern, not a
      // defect, and this rule fires on exactly that.
      'sonarjs/no-identical-functions': 'off',
    },
  },
  {
    // Type-aware rules.
    //
    // These need a `projectService` and therefore a real type-checked program per
    // file, which is why they are a separate block rather than part of
    // `recommended`. They are included because each catches a defect class that
    // no other rule here sees:
    //
    //  - `no-floating-promises` — a promise created and dropped. A dropped
    //    promise that rejects is an unhandled rejection: the request appears to
    //    succeed while its work silently failed. This tree is full of deliberate
    //    `void someAsync()`, so the rule is on but `void` is the sanctioned
    //    escape hatch, which is what makes it readable.
    //  - `no-misused-promises` — a promise passed where a value is expected.
    //
    // `require-await` was tried here and removed: it reported 130 violations,
    // nearly all of them interface-satisfying methods that return a value
    // synchronously and are declared `async` because the interface says so.
    // Dropping `async` would change the declared return type, so the rule was not
    // reporting a defect — it was reporting the design. A gate that reports the
    // design is a gate that gets switched off.
    //
    // `await-thenable` and `no-unnecessary-type-assertion` are deliberately
    // excluded: they fire heavily on this codebase's existing
    // `as unknown as T` boundary casts, which the migration work addresses
    // rather than a lint rule.
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}', 'tools/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['**/*.{test,spec}.{js,mjs,ts,tsx}'],
    rules: {
      'no-console': 'off',
      // The property/identifier lists live in `scripts/disabled-tests.mjs` so
      // this rule and `unify-preflight` cannot drift apart. The old selectors
      // matched only `.skip` and `.only`, which missed `xdescribe`, `xit`,
      // `test.todo`, `test.skipIf`, `test.runIf` and `test.fails` — every one of
      // them a way to commit a test that never runs.
      'no-restricted-syntax': [
        'error',
        ...[...SKIPPED_TEST_PROPERTY_SET, ...FOCUSED_TEST_PROPERTY_SET].map((property) => ({
          selector: `MemberExpression[property.name=${JSON.stringify(property)}]`,
          message: `Do not commit .${property}() in test files.`,
        })),
        ...[...SKIPPED_TEST_IDENTIFIER_SET].map((identifier) => ({
          selector: `CallExpression[callee.name=${JSON.stringify(identifier)}]`,
          message: `Do not commit ${identifier}() in test files.`,
        })),
      ],
    },
  },
);
