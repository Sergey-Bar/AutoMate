import { test, expect } from '@playwright/test';

/**
 * E2E tests for settings navigation.
 *
 * These tests verify that the settings pages render correctly
 * and display the expected content.
 */
test.describe('Settings', () => {
  test('navigates to model settings', async ({ page }) => {
    await page.goto('/settings/model');

    // The model settings page shows these form labels
    await expect(page.getByText('Model Settings')).toBeVisible();
    await expect(page.getByText('Provider')).toBeVisible();
    await expect(page.getByText('Endpoint')).toBeVisible();
    await expect(page.getByText('Max Tokens')).toBeVisible();
  });

  test('navigates to vault settings', async ({ page }) => {
    await page.goto('/settings/vault');

    // Vault settings page shows lock status and unlock button
    await expect(page.getByText('Vault Settings')).toBeVisible();
    await expect(page.getByText('Unlock Vault')).toBeVisible();
  });

  test('navigates to connector settings', async ({ page }) => {
    await page.goto('/settings/connectors');

    // Connector settings page shows connector list (loaded from API)
    await expect(page.getByText('Connector Settings')).toBeVisible();
    // The connector names come from the API — GitHub, Jira, Slack
    await expect(page.getByRole('heading', { name: /GitHub/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /Jira/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Slack/ })).toBeVisible();
  });
});
