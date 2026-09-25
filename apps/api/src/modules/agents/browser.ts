/**
 * browser.ts — Browser agent route (maps to test-generation capability)
 *
 * POST /api/v1/agents/browser/generate
 *   Body: { prompt: string }
 *   Response: AgentResult with status: 'completed' and generated test code
 *
 * Maps the existing test-gen capability (orchestrator module) to the
 * browser agent domain as specified in PRD §7.4.
 */
import { Hono } from 'hono';
import type { AgentResult } from './domains.js';

// ---------------------------------------------------------------------------
// Mock test generation (mirrors orchestrator test-gen capability)
// ---------------------------------------------------------------------------

const MOCK_BROWSER_TEST = `import { test, expect } from '@playwright/test';

test.describe('Generated browser test', () => {
  test('should load the page and verify key elements', async ({ page }) => {
    // Post-MVP: Accept baseUrl from generate request and inject here.
    // Current: User must manually update URL in generated test.
    await page.goto('https://example.com');
    await expect(page).toHaveTitle(/Example/);
  });

  test('should interact with primary UI elements', async ({ page }) => {
    await page.goto('https://example.com');
    // Post-MVP: AI-driven selector generation from natural language prompt.
    // See docs/PRD-MVP-gap-analysis.md § Browser Agent for full spec.
    await expect(page.locator('body')).toBeVisible();
  });
});`;

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface BrowserAgentOptions {
  /** Optional mock override — inject in tests for deterministic assertions */
  mockGenerateFn?: (prompt: string) => AgentResult;
}

export function createBrowserAgentRoutes(
  options: BrowserAgentOptions = {},
): Hono {
  const app = new Hono();

  // ── POST /api/v1/agents/browser/generate ──────────────────────────────────
  app.post('/api/v1/agents/browser/generate', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { prompt } = body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return c.json({ error: 'prompt is required and must be a non-empty string' }, 400);
    }

    if (options.mockGenerateFn) {
      return c.json(options.mockGenerateFn(prompt.trim()));
    }

    const result: AgentResult = {
      domain: 'browser',
      status: 'completed',
      result: {
        testCode: MOCK_BROWSER_TEST,
        prompt: prompt.trim(),
        framework: 'playwright',
        generatedAt: new Date().toISOString(),
      },
    };

    return c.json(result);
  });

  return app;
}
