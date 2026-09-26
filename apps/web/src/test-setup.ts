/**
 * One jest-dom registration for the whole client suite.
 *
 * The 14 test files each imported jest-dom themselves, and they split across two
 * entry points: eight imported the bare `@testing-library/jest-dom` and six
 * imported `@testing-library/jest-dom/vitest`. The bare entry extends whichever
 * `expect` the global scope happens to carry, which under `globals: true` is
 * Vitest's — so it mostly worked, and "mostly" is the problem. A matcher that
 * registers against the wrong `expect` is a silently absent assertion.
 *
 * The `/vitest` entry imports `expect` from `vitest` directly, so it cannot
 * register against anything else. Loading it once here means a new test file gets
 * the matchers by existing, rather than by remembering an import line.
 */
import '@testing-library/jest-dom/vitest';
