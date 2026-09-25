import { test, expect } from '@playwright/test';

test.describe('AI Authoring Pillar', () => {
  test('navigates to /automate/ai-authoring and shows prompt input', async ({ page }) => {
    await page.goto('/automate/ai-authoring');
    await expect(page).toHaveURL(/\/automate\/ai-authoring/);
    await expect(page.getByTestId('nav-bar')).toBeVisible();
    const promptInput = page.locator(
      '[data-testid="ai-authoring-prompt"], textarea, [role="textbox"]'
    );
    await expect(promptInput.first()).toBeVisible();
  });

  test('submitting a prompt shows generated code output', async ({ page }) => {
    await page.goto('/automate/ai-authoring');
    const promptInput = page
      .locator('[data-testid="ai-authoring-prompt"], textarea, [role="textbox"]')
      .first();
    await promptInput.fill('Generate a test for the login page');
    const submitBtn = page.locator(
      '[data-testid="generate-code"], button[type="submit"], button:has-text("Generate")'
    );
    await submitBtn.first().click();
    const codeOutput = page.locator(
      '[data-testid="generated-code"], pre, code, [role="code"]'
    );
    await expect(codeOutput.first()).toBeVisible();
  });

  test('navigates to /automate/codegen and shows codegen page', async ({ page }) => {
    await page.goto('/automate/codegen');
    await expect(page).toHaveURL(/\/automate\/codegen/);
    const codegenContent = page.locator('[data-testid="codegen-page"], main, [role="main"]');
    await expect(codegenContent.first()).toBeVisible();
  });

  test('navigates to /automate/mcp and shows MCP configuration', async ({ page }) => {
    await page.goto('/automate/mcp');
    await expect(page).toHaveURL(/\/automate\/mcp/);
    const mcpContent = page.locator('[data-testid="mcp-page"], main, [role="main"]');
    await expect(mcpContent.first()).toBeVisible();
  });
});
