/**
 * test-gen.ts — AI test generation endpoint (mock response)
 *
 * POST /api/v1/orchestrator/test-gen
 *   Body: { source: string, mode: 'requirement' | 'diff' }
 *   Response: { testCode: string, mode: string, warnings: string[] }
 */
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type TestGenMode = 'requirement' | 'diff';

export interface TestGenResult {
  testCode: string;
  mode: TestGenMode;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Mock generators
// ---------------------------------------------------------------------------

const MOCK_REQUIREMENT_TEST = `describe('Feature under test', () => {
  it('should satisfy the given requirement', () => {
    // Post-MVP: AI-generated assertions based on parsed requirement text.
    // Feature flag: test-gen-requirement
    expect(true).toBe(true);
  });

  it('should handle edge cases', () => {
    // Post-MVP: Edge case detection from requirement analysis.
    // Feature flag: test-gen-requirement
    expect(true).toBe(true);
  });
});`;

const MOCK_DIFF_TEST = `describe('Changed behaviour', () => {
  it('should verify the added functionality', () => {
    // Post-MVP: Test generation from git diff analysis.
    // Feature flag: test-gen-diff
    expect(true).toBe(true);
  });

  it('should not break existing behaviour', () => {
    // Post-MVP: Regression coverage from affected code paths.
    // Feature flag: test-gen-diff
    expect(true).toBe(true);
  });
});`;

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface OrchestratorTestGenOptions {
  /** Optional override for mock generation — useful in tests */
  mockGenerateFn?: (source: string, mode: TestGenMode) => TestGenResult;
}

const VALID_MODES: TestGenMode[] = ['requirement', 'diff'];

export function createOrchestratorTestGenRoutes(
  options: OrchestratorTestGenOptions = {},
): Hono {
  const app = new Hono();

  // ── POST /api/v1/orchestrator/test-gen ────────────────────────────────────
  app.post('/api/v1/orchestrator/test-gen', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;

    const { source, mode } = body;

    if (typeof source !== 'string' || !source.trim()) {
      return c.json({ error: 'source is required' }, 400);
    }

    if (typeof mode !== 'string' || !(VALID_MODES as string[]).includes(mode)) {
      return c.json(
        { error: `mode must be one of: ${VALID_MODES.join(', ')}` },
        400,
      );
    }

    const validMode = mode as TestGenMode;

    if (options.mockGenerateFn) {
      const result = options.mockGenerateFn(source, validMode);
      return c.json(result);
    }

    const testCode =
      validMode === 'requirement' ? MOCK_REQUIREMENT_TEST : MOCK_DIFF_TEST;

    const result: TestGenResult = {
      testCode,
      mode: validMode,
      warnings: [],
    };

    return c.json(result);
  });

  return app;
}
