/**
 * Ambient declarations for the ESLint plugins that ship no types of their own.
 *
 * `eslint-plugin-security` and `eslint-plugin-jsx-a11y` are plain CommonJS with no
 * bundled `.d.ts`, and neither has a `@types` package on npm. Under `checkJs` — which
 * `tsconfig.scripts.json` enables for the gate scripts — importing them without a
 * declaration is `TS7016: Could not find a declaration file for module`, and an
 * untyped import is worse than none: the plugin's options object would accept
 * anything.
 *
 * This file is reached because `scripts/complexity-eslint.config.mjs` imports
 * `eslint.config.js`, which imports both plugins. That is the good direction to fail
 * in — the repository's own ESLint config is now inside the checked program rather than
 * beside it — but it is only checkable if these two modules have a shape to check
 * against. Declaring them `any`-shaped is honest: there is nothing finer to say, and
 * pretending otherwise would be a fiction the compiler could not enforce.
 *
 * `eslint-plugin-sonarjs` needs no entry here because it does ship types.
 */
declare module 'eslint-plugin-security';
declare module 'eslint-plugin-jsx-a11y';
