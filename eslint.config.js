import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import security from 'eslint-plugin-security';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import {
  FOCUSED_TEST_PROPERTY_SET,
  SKIPPED_TEST_IDENTIFIER_SET,
  SKIPPED_TEST_PROPERTY_SET,
} from './scripts/disabled-tests.mjs';

/**
 * The `backdrop-*` utilities a component may write.
 *
 * **A list, and Phase 2 rather than a pattern.** Phase 1 answered the concern behind the
 * ban with a total prohibition, and the concern was right — `.github/review-rules/rules.json`
 * states it in one line: *the pixels behind a panel in this product are usually the
 * evidence itself*. What a total prohibition cannot do is say **which** panels are safe, so
 * it was replaced by a measured rule and a narrow door rather than by an answer:
 *
 * - the legibility concern is now measurement. `packages/ui/src/tokens/theme.test.ts`
 *   computes the composite a glass panel paints its text on — the translucent fill over
 *   **every** plane step, in both themes — and requires 4.5:1 on each. A panel that is
 *   illegible over a static plane is a failing test rather than a reviewer's judgement.
 * - the cost concern is bounded by the tokens. Blur 8px and saturation 1.05, the floor of
 *   the scheduled 8–16px and 1.05–1.15 ranges, declared once in `theme.css`.
 * - the "cannot be invented per component" concern is this list. A pattern would let
 *   `backdrop-blur-md` appear in one panel and `backdrop-blur-glass` in the other five,
 *   which is the failure that makes a design language a preference.
 *
 * **This literal is checked against `theme.css`**, by
 * `apps/web/src/theme-resolution.test.ts`, which reads both and fails on drift. It cannot
 * be imported from `packages/ui/src/tokens/glass.ts` — a flat config is loaded by Node,
 * and a TypeScript import there would put a compiler between the linter and its own
 * policy. `apps/web/src/**` cannot import it either: the config imports ESLint, and the
 * web tests would inherit that. So: one literal, one direction of truth, one test that
 * says whether the two agree.
 */
export const GLASS_ALLOWLIST = ['backdrop-blur-glass', 'backdrop-saturate-glass'];

/**
 * The one `no-restricted-syntax` selector for the glass ban.
 *
 * **Exported rather than written inline, because flat config merges by last-wins and
 * that is a trap.** Two blocks that both set `no-restricted-syntax` for the same file
 * do not combine: the later one *replaces* the earlier. Adding the ban as its own
 * `ts`/`tsx` block silently switched off the double-assertion rule on
 * `packages/db/src/schema/**` and `packages/shared-contracts/src/**`, because that
 * block is scoped to the same extensions and this repository already has a rule there
 * doing something else. The only symptom was
 * `scripts/lib/contract-double-assertion.test.mjs` starting to fail — a gate
 * reporting the regression rather than causing it, which is the shape of failure this
 * file exists to prevent twice now.
 *
 * So the selector is one exported constant and every block that sets
 * `no-restricted-syntax` spreads it in. One copy of the rule, and a future fifth
 * block cannot drop it.
 *
 * **The `(?!…)` is built from `GLASS_ALLOWLIST`** rather than written out, so opening the
 * ban and widening the list are the same edit. A hand-written exception beside a
 * hand-written list is two things to keep in step, and this repository has already paid
 * for that class of mistake twice in this file alone.
 */
export const GLASS_SELECTOR = {
  selector: `Literal[value=/(^|[\\s"'\`])backdrop-(?!${GLASS_ALLOWLIST.map(
    (utility) => utility.replace(/^backdrop-/, '') + '\\b',
  ).join(
    '|',
  )})(blur|filter|saturate|brightness|contrast|grayscale|invert|sepia|hue-rotate|opacity)\\b/]`,
  message:
    'A `backdrop-filter` outside GLASS_ALLOWLIST. Legibility over a sampled backdrop is ' +
    'measured in packages/ui/src/tokens/theme.test.ts and the radius is a token in ' +
    'theme.css — so use `backdrop-blur-glass` / `backdrop-saturate-glass`, and note that a ' +
    'backdrop sampled over data is the case the design language treats as settled, not ' +
    'as free. An opaque surface token and an elevation shadow remain the answer for ' +
    'anything sitting on evidence.',
};

/** The same ban for a value written in code rather than in a class string. */
export const GLASS_PROPERTY_SELECTOR = {
  selector: "Property[key.name='backdropFilter'], Property[key.name='webkitBackdropFilter']",
  message:
    'No inline backdrop-filter. A filter written in code cannot be a token, so it cannot ' +
    'be measured against the worst-case backdrop or neutralised under ' +
    '`prefers-reduced-transparency`. Put it in theme.css and use the utility.',
};

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.kilo/**',
      /**
       * Storybook's static build, and **the reason it has to be listed here rather
       * than left to `.gitignore`** is that ESLint does not read `.gitignore`.
       *
       * Its output is 21,900 lines of minified bundle across `assets/`, and linting
       * it produced 21,907 errors — every one of them a `prefer-const` in a build
       * artefact, none of them about this repository's code. A gate that reports
       * 22,000 findings from a generated directory is a gate nobody reads, which is
       * the failure `SEM-2`'s 543 semgrep findings already taught this repository
       * once.
       *
       * The `dist` rule covers `site/dist` and the application builds; `storybook
       * build` writes to `packages/ui/storybook-static`, which is not a configured
       * `outDir` — it is Storybook's own default — so there is no Vite key to point
       * somewhere already ignored. It is listed in `.gitignore` as well, and both
       * listings are load-bearing for a different tool.
       */
      '**/storybook-static/**',
      // `site/` needs nothing here. Its only source file is `.vitepress/config.mts`,
      // the `**/*` blocks lint it, and its build output and dependency cache are
      // already covered by the `dist/` and `node_modules/` rules above — which is
      // what `outDir: 'dist'` in site/.vitepress/config.mts exists to keep true.
      // An earlier revision added `**/.vitepress/cache/**` here, a comment that
      // said the path could not exist, and left the rule in anyway.
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
        // Paired with `setTimeout`, and added with it: `scripts/static-analysis.mjs`
        // needs a timer to bound a scanner that will otherwise never return, and a
        // timer that cannot be cancelled is the hang it was added to end.
        clearTimeout: 'readonly',
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
    // 71 — the two largest files, which the W5.1 split addresses. Turning it on
    // as an error today would fail `pnpm lint` on code nobody is touching, and
    // the realistic outcome of a permanently red lint gate is that it gets
    // switched off, taking the other two rules with it. It becomes an error as
    // part of that split, and `docs/quality/complexity-baseline.json` — the file
    // `pnpm complexity:baseline` actually writes, and the one the ratchet reads —
    // records the current offenders so the ceiling can only ratchet down from
    // there.
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
    // Two rule families that catch defect classes nothing else here sees.
    //
    // `security/detect-non-literal-fs-filename` was tried and **turned off**,
    // deliberately. It reports every `fs` call whose path is a variable, and in a
    // codebase that composes paths as `path.join(root, relativePath)` that is
    // every filesystem call: 154 findings, none of them a traversal. The rule
    // has no notion of a confined base directory, which is precisely the
    // property that makes these calls safe here. A gate that reports 154
    // unfixable findings is a gate that gets switched off, and taking the two
    // specific rules with it.
    //
    // The rules that *are* on are the ones with no false-positive shape worth
    // arguing about: a path traversal, a child process from a string, an
    // expression handed to `eval`, and a regex that backtracks. That last one
    // matters more than usual here — this repository already had a ReDoS in a
    // hand-rolled JUnit parser, which is why the rule is on even though the
    // pattern is inherently hard to read as a regex.
    //
    // `jsx-a11y` is a real correctness tool for this product: a QA dashboard a
    // keyboard or screen-reader user cannot drive is not usable by them, and
    // nothing else here notices. The recommended set only — the strict set flags
    // ARIA patterns this codebase does not use yet.
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { security, 'jsx-a11y': jsxA11y },
    rules: {
      // Off: 154 findings, none a traversal. See above.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-unsafe-regex': 'error',
    },
  },
  {
    // `packages/ui` is in this list because it is where most of the interactive
    // surface actually lives: Dialog, Drawer, Table, Tabs, Select, Toggle,
    // Popover, CommandPalette and Splitter are all shared components, so scoping
    // the rules to the app left every one of them unlinted. The defects jsx-a11y
    // is good at finding (a control with no name, a click handler on a
    // non-interactive element, an `alt` that lies) were therefore structurally
    // invisible in the components that ship to every consumer.
    files: ['apps/web/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    rules: {
      ...jsxA11y.configs.recommended.rules,
    },
  },
  {
    // A focusable `role="separator"` is a window splitter, and ARIA 1.2 made it a
    // *widget*: `aria-valuenow` is required and the arrow keys resize it. That is
    // what `Splitter` now is, and what the a11y tests assert.
    //
    // `eslint-plugin-jsx-a11y@6` still classifies `separator` as non-interactive,
    // so `no-noninteractive-tabindex` and `no-noninteractive-element-interactions`
    // report a correct implementation as a defect. This is a false positive
    // against the current ARIA spec, not a component with a real problem, so it
    // is switched off for that one file with the reason recorded — the same
    // treatment `security/detect-non-literal-fs-filename` gets above, scoped as
    // narrowly as ESLint allows rather than disabled repo-wide.
    files: ['packages/ui/src/components/Splitter/Splitter.tsx'],
    rules: {
      'jsx-a11y/no-noninteractive-tabindex': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
    },
  },
  {
    /**
     * The glass ban, repo-wide (D6-9).
     *
     * **Declared before the two blocks that also set `no-restricted-syntax`, on
     * purpose.** Flat config is last-wins: two blocks that both set the rule for the
     * same file do not combine, the later one replaces the earlier. As the last
     * `ts`/`tsx` block this ban replaced the double-assertion rule on every schema
     * and contract file in the repository — which is why the selectors are shared
     * into those blocks rather than living only here, and why the ordering here is
     * load-bearing rather than incidental.
     *
     * Test files are excluded, because their whole purpose is to assert on markup
     * that may well contain the banned class. The selectors are spread into the
     * test-file block at the end of this file so the ban is not silently absent from
     * the one place it would matter most to forbid writing it at all.
     */
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', GLASS_SELECTOR, GLASS_PROPERTY_SELECTOR],
    },
  },
  {
    // The two contract trees refuse a double assertion.
    //
    // `new Date(0) as unknown as Date` and its relatives assert twice: the first
    // `as` silences a complaint the compiler made, and the second converts
    // `unknown` into whatever the call site wanted. Everywhere else in the tree
    // that is a debt worth carrying. Under the schema or under a shared contract
    // it is the worst place to carry it, because a value that reaches the
    // database or reaches every consumer is exactly the value whose type nothing
    // checked.
    //
    // Scoped to two directories rather than repo-wide on purpose: the plan's
    // W15.1 lands type-aware linting package by package, and a rule that fires
    // across the whole tree on day one is a rule that gets switched off. The
    // review ruleset carries the same rule as `double-assertion`, scoped the same
    // way, so the human review and the lint gate speak one vocabulary.
    //
    // The glass selectors are repeated here because the rule object replaces rather
    // than merges. Dropping them would silently un-ban `backdrop-filter` in exactly
    // the files where a hand-written assertion is most likely, so the repetition is
    // the point rather than an oversight.
    files: ['packages/db/src/schema/**/*.ts', 'packages/shared-contracts/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        GLASS_SELECTOR,
        GLASS_PROPERTY_SELECTOR,
        {
          selector: 'TSAsExpression > TSAsExpression',
          message:
            'Do not assert twice under a schema or a contract. Make the value have the ' +
            'type, or record why the boundary cannot be typed yet.',
        },
      ],
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
        GLASS_SELECTOR,
        GLASS_PROPERTY_SELECTOR,
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
