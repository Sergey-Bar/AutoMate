/**
 * The `/vitest` entry, not the bare one: it extends Vitest's `expect`
 * explicitly, so a matcher cannot end up registered against a different `expect`
 * than the one the assertions use.
 */
import '@testing-library/jest-dom/vitest';
