import { expect, test, type Page } from '@playwright/test';
import { WEB_BASE } from '../support/config.js';

/**
 * Every dialog can be left three ways (ledger `UX-DIALOG-1`).
 *
 * The defect: the shared `Dialog` had no close control and ignored its backdrop, so the
 * toolbox's tool dialog could only be left with Escape — which a phone does not have. The
 * unit tests prove the component; this proves the shipped bundle in a real browser, where
 * `<dialog>`, `::backdrop` and focus restoration are the engine's and not jsdom's stubs.
 *
 * Two dialogs that need no registered project, at a desktop and a phone size.
 */
const DIALOGS = [
  {
    name: 'runs launcher',
    path: '/dashboard/runs',
    trigger: 'New browser run',
    heading: 'Launch browser run',
  },
  {
    name: 'quarantine form',
    path: '/dashboard/quarantine',
    trigger: 'Add to Quarantine',
    heading: 'Quarantine a test',
  },
] as const;

async function openDialog(page: Page, trigger: string) {
  const button = page.getByRole('button', { name: trigger });
  await button.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  return { button, dialog };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const entry of DIALOGS) {
    test(`${entry.name} at ${String(viewport.width)}px closes by button, backdrop and Escape`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(`${WEB_BASE}${entry.path}`);

      const first = await openDialog(page, entry.trigger);
      await expect(first.dialog.getByRole('heading', { name: entry.heading })).toBeVisible();
      await first.dialog.getByRole('button', { name: 'Close' }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(first.button).toBeFocused();

      await openDialog(page, entry.trigger);
      // A corner of the viewport is backdrop at every size: the dialog keeps a margin.
      await page.mouse.click(4, viewport.height - 4);
      await expect(page.locator('dialog[open]')).toHaveCount(0);

      await openDialog(page, entry.trigger);
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    });
  }
}
