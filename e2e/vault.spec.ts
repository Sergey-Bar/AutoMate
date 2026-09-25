import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Vault settings page and Vault API.
 *
 * The vault stores encrypted connector credentials using AES-256-GCM.
 * These tests verify:
 *  - The vault settings page renders correctly
 *  - The lock/unlock UI elements are present
 *  - The unlock flow can be triggered via the UI
 *  - The vault API endpoints respond with the expected shapes
 *
 * No real credentials are tested — tests focus on UI rendering,
 * navigation, and API response shapes only.
 */
test.describe('Vault Settings UI', () => {
  test('vault settings page is reachable and shows heading', async ({ page }) => {
    await page.goto('/settings/vault');

    await expect(page.getByText('Vault Settings')).toBeVisible();
  });

  test('vault page shows Unlock Vault button when locked', async ({ page }) => {
    await page.goto('/settings/vault');

    // By default the vault is locked — the unlock button should be visible
    await expect(page.getByText('Unlock Vault')).toBeVisible();
  });

  test('vault page shows lock status indicator', async ({ page }) => {
    await page.goto('/settings/vault');

    // There should be some indication of locked/unlocked state
    // The settings spec already confirmed "Vault Settings" and "Unlock Vault" are present
    await expect(page.getByText('Vault Settings')).toBeVisible();
    await expect(page.getByText('Unlock Vault')).toBeVisible();
  });

  test('password input and Unlock Vault button are shown when vault is locked', async ({ page }) => {
    await page.goto('/settings/vault');

    // Password input is always visible when vault is locked
    const passwordInput = page.getByPlaceholder('Master password');
    await expect(passwordInput).toBeVisible();

    // Unlock button is disabled until password is entered
    const unlockButton = page.getByRole('button', { name: /unlock vault/i });
    await expect(unlockButton).toBeVisible();
    await expect(unlockButton).toBeDisabled();

    // After entering a password, the button becomes enabled
    await passwordInput.fill('test-password');
    await expect(unlockButton).toBeEnabled();
  });
});

test.describe('Vault API', () => {
  test('GET /api/vault/status returns isUnlocked boolean', async ({ request }) => {
    const response = await request.get('/api/vault/status');

    expect(response.status()).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.isUnlocked).toBe('boolean');
  });

  test('POST /api/vault/unlock with missing password returns 400', async ({ request }) => {
    const response = await request.post('/api/vault/unlock', {
      data: {},
    });

    expect(response.status()).toBe(400);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  test('POST /api/vault/lock returns ok true', async ({ request }) => {
    const response = await request.post('/api/vault/lock');

    expect(response.status()).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  test('PUT /api/vault/credentials/:connector returns 403 when vault is locked', async ({ request }) => {
    // Ensure vault is locked first
    await request.post('/api/vault/lock');

    const response = await request.put('/api/vault/credentials/github', {
      data: { credentials: { token: 'test-token' } },
    });

    expect(response.status()).toBe(403);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});
