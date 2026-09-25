import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEnabled, type FeatureFlagName } from '../services/feature-flags.js';

// Flags that are still OFF by default and must remain kill-switchable
const DASHBOARD_FLAG_CASES = [
  { flag: 'mcp-server', envVar: 'FEATURE_MCP_SERVER' },
  { flag: 'role-based-views', envVar: 'FEATURE_ROLE_BASED_VIEWS' },
] as const satisfies ReadonlyArray<{ flag: FeatureFlagName; envVar: string }>;

// Flags graduated to ON in v2.1 — must be disableable via env var kill switch
const V21_GRADUATED_FLAG_CASES = [
  { flag: 'failure-taxonomy', envVar: 'FEATURE_FAILURE_TAXONOMY' },
  { flag: 'predictive-test-selection', envVar: 'FEATURE_PREDICTIVE_TEST_SELECTION' },
  { flag: 'locator-intelligence', envVar: 'FEATURE_LOCATOR_INTELLIGENCE' },
] as const satisfies ReadonlyArray<{ flag: FeatureFlagName; envVar: string }>;

describe('kill-switch drill (dashboard feature flags)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const { envVar } of [...DASHBOARD_FLAG_CASES, ...V21_GRADUATED_FLAG_CASES]) {
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  for (const { flag, envVar } of DASHBOARD_FLAG_CASES) {
    describe(flag, () => {
      it('defaults to false when no env override is set', () => {
        expect(isEnabled(flag)).toBe(false);
      });

      it('enables when env var is true', () => {
        process.env[envVar] = 'true';
        expect(isEnabled(flag)).toBe(true);
      });

      it('disables when env var is false', () => {
        process.env[envVar] = 'false';
        expect(isEnabled(flag)).toBe(false);
      });

      it('falls back to false when env var is unset', () => {
        process.env[envVar] = 'true';
        expect(isEnabled(flag)).toBe(true);

        delete process.env[envVar];
        expect(isEnabled(flag)).toBe(false);
      });
    });
  }

  describe('v2.1 graduated flags — default true, can be disabled via kill switch', () => {
    for (const { flag, envVar } of V21_GRADUATED_FLAG_CASES) {
      describe(flag, () => {
        it('defaults to true when no env override is set', () => {
          expect(isEnabled(flag)).toBe(true);
        });

        it('can be disabled via env var kill switch', () => {
          process.env[envVar] = 'false';
          expect(isEnabled(flag)).toBe(false);
        });

        it('can be re-enabled via env var', () => {
          process.env[envVar] = 'true';
          expect(isEnabled(flag)).toBe(true);
        });

        it('falls back to true (default) when env var is unset', () => {
          process.env[envVar] = 'false';
          expect(isEnabled(flag)).toBe(false);

          delete process.env[envVar];
          expect(isEnabled(flag)).toBe(true);
        });
      });
    }
  });
});
