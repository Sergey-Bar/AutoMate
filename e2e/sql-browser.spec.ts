import { test, expect } from '@playwright/test';

/**
 * E2E tests for the SQL Browser page (/sql).
 *
 * The SQL Browser lets users describe a query in natural language and
 * generates a safe, read-only SELECT statement via the AI backend.
 * These tests verify page rendering and UI interactions only —
 * they do NOT require Ollama to be running.
 */
test.describe('SQL Browser', () => {
  test('SQL Browser page loads with expected heading', async ({ page }) => {
    await page.goto('/sql');

    await expect(page.getByRole('heading', { name: 'Text-to-SQL Browser' })).toBeVisible();
  });

  test('query textarea is visible and has correct placeholder', async ({ page }) => {
    await page.goto('/sql');

    const textarea = page.locator('#sql-query');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();
    await expect(textarea).toHaveAttribute(
      'placeholder',
      'e.g., Show all conversations from the last 7 days',
    );
  });

  test('query label is visible', async ({ page }) => {
    await page.goto('/sql');

    await expect(page.getByText('Describe your query in natural language')).toBeVisible();
  });

  test('Generate SQL button is visible and initially disabled when textarea is empty', async ({ page }) => {
    await page.goto('/sql');

    const button = page.getByRole('button', { name: 'Generate SQL' });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  });

  test('Generate SQL button becomes enabled after typing a query', async ({ page }) => {
    await page.goto('/sql');

    const textarea = page.locator('#sql-query');
    await textarea.fill('Show all conversations');

    const button = page.getByRole('button', { name: 'Generate SQL' });
    await expect(button).toBeEnabled();
  });

  test('Ctrl+Enter hint text is visible', async ({ page }) => {
    await page.goto('/sql');

    await expect(page.getByText('Ctrl+Enter to submit')).toBeVisible();
  });

  test('result area is not shown before any query is submitted', async ({ page }) => {
    await page.goto('/sql');

    // The "Generated SQL" heading and pre block only appear when result has content
    await expect(page.getByRole('heading', { name: 'Generated SQL' })).not.toBeVisible();
  });

  test('typing in the textarea updates its value', async ({ page }) => {
    await page.goto('/sql');

    const textarea = page.locator('#sql-query');
    const queryText = 'List all conversations created today';
    await textarea.fill(queryText);

    await expect(textarea).toHaveValue(queryText);
  });
});
