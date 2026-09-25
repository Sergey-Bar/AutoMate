import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility E2E audit for Automate.
 *
 * Uses @axe-core/playwright to run WCAG 2.0 and WCAG 2.1 (A + AA) audits
 * against each key page. Critical and serious violations cause test failure.
 *
 * Prerequisites:
 * - Server and web dev servers started (handled by playwright.config.ts webServer)
 * - No Ollama required — these tests only audit static/rendered UI.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Returns a human-readable summary of an axe violation for assertion messages.
 */
function formatViolation(violation: {
  id: string;
  impact: string | null;
  description: string;
  nodes: Array<{ html: string }>;
}): string {
  const sample = violation.nodes[0]?.html ?? '(no node)';
  return `[${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.description} — e.g. ${sample}`;
}

test.describe('Accessibility audit', () => {
  test('chat page (/) has no critical or serious violations', async ({ page }) => {
    await page.goto('/');
    // Wait for the page shell to be rendered before auditing
    await expect(page.locator('body')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_TAGS])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blocking,
      blocking.map(formatViolation).join('\n'),
    ).toEqual([]);
  });

  test('settings model page (/settings/model) has no critical or serious violations', async ({
    page,
  }) => {
    await page.goto('/settings/model');
    await expect(page.getByText('Model Settings')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_TAGS])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blocking,
      blocking.map(formatViolation).join('\n'),
    ).toEqual([]);
  });

  test('settings vault page (/settings/vault) has no critical or serious violations', async ({
    page,
  }) => {
    await page.goto('/settings/vault');
    await expect(page.getByText('Vault Settings')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_TAGS])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blocking,
      blocking.map(formatViolation).join('\n'),
    ).toEqual([]);
  });

  test('settings connectors page (/settings/connectors) has no critical or serious violations', async ({
    page,
  }) => {
    await page.goto('/settings/connectors');
    // Connector list is loaded from the API — wait for at least one heading
    await page.getByRole('heading', { name: /GitHub/i }).waitFor({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_TAGS])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blocking,
      blocking.map(formatViolation).join('\n'),
    ).toEqual([]);
  });
});
