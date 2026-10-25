import { expect, test, type Page } from '@playwright/test';
import { WEB_BASE } from '../support/config.js';
import { observedSummary, saveEvidence, saveEvidenceText } from '../support/evidence.js';

/**
 * The Overview and the repo map, against the real stack.
 *
 * The stack registers this repository at boot (`AUTOMATE_PROJECT_ROOT` in
 * `playwright.config.ts`), so the map drawn here is a map of this tree — real packages,
 * real reports, real tools — and the Overview's verdict is the API's own readiness card.
 * What is asserted is what a QA lead relies on: a verdict in words, findings that open a
 * real page, a map whose state survives a reload, and a phone layout that still reaches
 * every section.
 */

const EVIDENCE = 'overview-and-map';
const VERDICT = /^(Go|Caution|No-go)$/u;

async function verdictWord(page: Page): Promise<string> {
  const verdict = page.getByTestId('readiness-verdict');
  await expect(verdict, 'the Overview must lead with a verdict').toBeVisible({ timeout: 20_000 });
  return ((await verdict.textContent()) ?? '').trim();
}

test.describe('the overview', () => {
  test('leads with a verdict in words, then what is wrong beside what is good', async ({
    page,
  }) => {
    await page.goto(`${WEB_BASE}/dashboard`);
    const word = await verdictWord(page);
    expect(word, 'the verdict is spelled out, never only a colour').toMatch(VERDICT);

    const wrong = page.getByTestId('findings-wrong');
    const good = page.getByTestId('findings-good');
    await expect(wrong).toBeVisible();
    await expect(good).toBeVisible();

    // Above the detail: the verdict is read before any figure.
    const heroBox = await page.getByTestId('readiness-hero').boundingBox();
    const figuresBox = await page.getByRole('region', { name: 'Key figures' }).boundingBox();
    expect(heroBox?.y ?? Infinity).toBeLessThan(figuresBox?.y ?? 0);

    saveEvidenceText(
      EVIDENCE,
      'overview.txt',
      observedSummary('Overview — observed', {
        verdict: word,
        'what is wrong': ((await wrong.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 300),
        'what is good': ((await good.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 300),
      }),
    );
    await page.screenshot({ path: `test-results/${EVIDENCE}/overview.png`, fullPage: true });
  });

  test('a finding’s next action opens a real page', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard`);
    await verdictWord(page);
    const action = page.getByTestId('findings-wrong').getByRole('link').first();
    const fallback = page.getByTestId('findings-good').getByRole('link').first();
    // Readiness always carries at least one reason, and every reason has an action, so one
    // of the two columns has a link on any install.
    const link = (await action.count()) > 0 ? action : fallback;
    await expect(link, 'no finding offers a next action').toBeVisible();
    const target = (await link.getAttribute('href')) ?? '';
    await link.click();
    await expect(page).toHaveURL(`${WEB_BASE}${target}`);
    await expect(page.locator('main h1')).toBeVisible();
  });
});

test.describe('the repo map', () => {
  test('draws this repository, explores it, and keeps its state in the URL', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard/map`);
    const canvas = page.getByTestId('map-canvas');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(canvas.locator('[data-node="verdict"]')).toBeVisible();

    // The packages view names this tree's own packages.
    await page.getByRole('button', { name: 'Packages' }).click();
    await expect(page).toHaveURL(/view=packages/u);
    await expect(canvas.locator('[data-node="pkg:apps/web"]')).toBeVisible();

    // Open a package's evidence, then close it with Escape.
    await canvas.locator('[data-node="pkg:apps/web"]').click();
    const detail = page.getByTestId('map-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'apps/web' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();

    // The blocking path is a toggle and a URL parameter, and a reload keeps both.
    const toggle = page.getByRole('button', { name: 'Show blocking path' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/path=true/u);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show blocking path' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('group', { name: 'Repository map, packages view' })).toBeVisible();

    const nodes = await canvas.locator('[data-node]').evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.getAttribute('data-node'),
        status: element.getAttribute('data-status'),
      })),
    );
    saveEvidence(EVIDENCE, 'packages-map.json', { url: page.url(), nodes });
    await page.screenshot({ path: `test-results/${EVIDENCE}/map.png`, fullPage: true });
  });

  test('the flow view ends at the same verdict the Overview reads', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard`);
    const word = await verdictWord(page);
    await page.goto(`${WEB_BASE}/dashboard/map?view=flow`);
    const verdict = page.locator('[data-node="verdict"]');
    await expect(verdict).toBeVisible({ timeout: 20_000 });
    // The node's name starts with its label, so "Go" cannot match inside "No-go".
    // The node's name is computed from what it shows (MNT-5), so the assertion reads the
    // accessible name rather than an attribute the component no longer sets.
    await expect(verdict).toHaveAccessibleName(new RegExp(`^${word}\\s*,`, 'u'));
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every section is a thumb away, and the map becomes a list', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard`);
    const bottom = page.getByTestId('bottom-tab-bar');
    await expect(bottom).toBeVisible({ timeout: 20_000 });
    // The top bar's section links are hidden at this width; the bottom bar carries them.
    await expect(page.getByTestId('nav-bar').getByRole('link', { name: 'Map' })).toBeHidden();

    for (const [label, path] of [
      ['Runs', '/dashboard/runs'],
      ['Insights', '/dashboard/insights'],
      ['Map', '/dashboard/map'],
      // Overview's section path is the portfolio since repository health became the landing.
      ['Overview', '/dashboard/portfolio'],
    ] as const) {
      await bottom.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(`${WEB_BASE}${path}`);
      await expect(bottom.getByRole('link', { name: label })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }

    await bottom.getByRole('link', { name: 'Map' }).click();
    await expect(page.getByTestId('map-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('map-canvas')).toHaveCount(0);

    // Nothing is wider than the screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the page scrolls sideways on a phone').toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/${EVIDENCE}/phone-map.png`, fullPage: true });
  });
});
