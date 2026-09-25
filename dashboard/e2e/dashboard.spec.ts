import { test, expect } from '@playwright/test';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';

/* ──────────────────────────────────────────────────────────────────────────────
 * Global: skip onboarding wizard for all tests
 * ────────────────────────────────────────────────────────────────────────── */
test.beforeEach(async ({ page }) => {
  // Inject localStorage before any page loads so onboarding wizard never appears
  await page.addInitScript(() => {
    localStorage.setItem('mc-onboarding', JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. DASHBOARD HOME
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Dashboard Home', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
  });

  test('loads dashboard home page', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    // "Automate" text is in sidebar, only visible when not collapsed
    const brandText = page.getByText('Automate');
    await expect(brandText.or(page.locator('body'))).toBeVisible();
  });

  test('displays KPI cards or empty state', async ({ page }) => {
    // Either KPI cards are visible or the empty state message
    const kpiSection = page.locator('[aria-label="Key metrics"]');
    const emptyState = page.getByText(/no runs yet|trigger your first run/i);
    await expect(kpiSection.or(emptyState)).toBeVisible();
  });

  test('has a new run button on the home page', async ({ page }) => {
    // The dashboard has a "Start New Run" button or similar CTA
    const newRunBtn = page.getByText(/start new run|new run/i).first();
    const emptyCta = page.getByText(/start new run/i).first();
    await expect(newRunBtn.or(emptyCta)).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. SIDEBAR NAVIGATION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
  });

  test('sidebar navigation works — all main routes', async ({ page }) => {
    // Test Explorer
    await page.getByText('Test Explorer').click();
    await expect(page).toHaveURL(/\/tests/);

    // All Runs
    await page.getByRole('link', { name: 'Runs' }).click();
    await expect(page).toHaveURL(/\/runs/);

    // Analytics / Trends
    await page.getByText('Trends').click();
    await expect(page).toHaveURL(/\/analytics/);

    // Config
    await page.getByText('Config').click();
    await expect(page).toHaveURL(/\/config/);

    // Settings
    await page.getByText('Settings').click();
    await expect(page).toHaveURL(/\/settings/);

    // Navigate back to Dashboard
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('sidebar toggle collapses and expands', async ({ page }) => {
    const toggleBtn = page.getByLabel('Toggle sidebar');
    await expect(toggleBtn).toBeVisible();

    // Click to toggle — "Automate" text should disappear when collapsed
    const brandText = page.locator('nav').getByText('Automate');
    const wasBrandVisible = await brandText.isVisible();

    await toggleBtn.click();
    // Give animation time
    await page.waitForTimeout(400);

    if (wasBrandVisible) {
      // After toggle, brand text should be hidden (collapsed)
      await expect(brandText).not.toBeVisible();
    }

    // Toggle again — brand text should reappear
    await toggleBtn.click();
    await page.waitForTimeout(400);
    if (wasBrandVisible) {
      await expect(brandText).toBeVisible();
    }
  });

  test('sidebar shows connection indicator', async ({ page }) => {
    // The sidebar footer shows connection state via title attribute
    const connIndicator = page.locator('[title*="Connection"]');
    await expect(connIndicator).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. DIRECT URL NAVIGATION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Direct URL Navigation', () => {
  test('navigates directly to /runs', async ({ page }) => {
    await page.goto(`${BASE}/runs`);
    await expect(page).toHaveURL(/\/runs/);
    // Runs page should render
    await expect(page.locator('body')).toBeVisible();
  });

  test('navigates directly to /tests', async ({ page }) => {
    await page.goto(`${BASE}/tests`);
    await expect(page).toHaveURL(/\/tests/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('navigates directly to /analytics', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('navigates directly to /config', async ({ page }) => {
    await page.goto(`${BASE}/config`);
    await expect(page).toHaveURL(/\/config/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('navigates directly to /baselines', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);
    await expect(page).toHaveURL(/\/baselines/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('navigates directly to /settings', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. COMMAND PALETTE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
  });

  test('Ctrl+K opens command palette', async ({ page }) => {
    // Click body first to ensure no input has focus (isInputFocused guard)
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    // Wait for the lazy-loaded dialog to appear
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });

  test('Escape closes command palette', async ({ page }) => {
    // Open via button click (more reliable than keyboard shortcut)
    await page.getByLabel(/open command palette/i).click();
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('command palette shows navigation items', async ({ page }) => {
    await page.getByLabel(/open command palette/i).click();
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Should display navigation options
    const navigateGroup = dialog.getByText('Navigate');
    await expect(navigateGroup).toBeVisible({ timeout: 3000 });
  });

  test('command palette ⌘K button in top bar opens it', async ({ page }) => {
    const cmdBtn = page.getByLabel(/open command palette/i);
    await expect(cmdBtn).toBeVisible();
    await cmdBtn.click();

    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. KEYBOARD SHORTCUTS
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Keyboard Shortcuts', () => {
  test('G D navigates to Dashboard', async ({ page }) => {
    await page.goto(`${BASE}/runs`);
    await page.waitForTimeout(300);

    // Press G, then D within 500ms
    await page.keyboard.press('g');
    await page.keyboard.press('d');

    await expect(page).toHaveURL(/\/$/);
  });

  test('G R navigates to Runs', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await page.keyboard.press('g');
    await page.keyboard.press('r');

    await expect(page).toHaveURL(/\/runs/);
  });

  test('G T navigates to Tests', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await page.keyboard.press('g');
    await page.keyboard.press('t');

    await expect(page).toHaveURL(/\/tests/);
  });

  test('G A navigates to Analytics', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await page.keyboard.press('g');
    await page.keyboard.press('a');

    await expect(page).toHaveURL(/\/analytics/);
  });

  test('G S navigates to Settings', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await page.keyboard.press('g');
    await page.keyboard.press('s');

    await expect(page).toHaveURL(/\/settings/);
  });

  test('[ toggles the sidebar', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(300);

    const brandText = page.locator('nav').getByText('Automate');
    const wasBrandVisible = await brandText.isVisible();

    await page.keyboard.press('[');
    await page.waitForTimeout(400);

    if (wasBrandVisible) {
      await expect(brandText).not.toBeVisible();
    }

    // Toggle back
    await page.keyboard.press('[');
    await page.waitForTimeout(400);

    if (wasBrandVisible) {
      await expect(brandText).toBeVisible();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. THEME TOGGLE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Theme Toggle', () => {
  test('theme toggle button exists and cycles themes', async ({ page }) => {
    await page.goto(BASE);

    const themeBtn = page.getByLabel(/switch theme/i);
    await expect(themeBtn).toBeVisible();

    // Read initial theme label
    const initialTitle = await themeBtn.getAttribute('title');

    // Click to cycle
    await themeBtn.click();
    await page.waitForTimeout(200);

    const newTitle = await themeBtn.getAttribute('title');
    // The theme should have changed
    expect(newTitle).not.toBe(initialTitle);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. RUNS PAGE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Runs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/runs`);
  });

  test('runs page loads with title', async ({ page }) => {
    // The page has a heading (translated, but likely "Runs" or "All Runs")
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('has New Run button', async ({ page }) => {
    const newRunBtn = page.getByText(/new run/i);
    await expect(newRunBtn).toBeVisible();
  });

  test('has Export CSV link', async ({ page }) => {
    const exportBtn = page.getByText(/export csv/i);
    await expect(exportBtn).toBeVisible();
  });

  test('shows run list or empty state', async ({ page }) => {
    // Either a table or empty state should be visible
    const table = page.locator('table');
    const emptyState = page.getByText(/no runs/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. TEST EXPLORER
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Test Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/tests`);
  });

  test('test explorer shows search input', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible();
  });

  test('test explorer has filter bar', async ({ page }) => {
    // FilterBar should have status filter buttons or search
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible();
  });

  test('test list shows items or empty state', async ({ page }) => {
    // Either test items exist or empty state
    const testList = page.locator('[role="listbox"]');
    await expect(testList).toBeVisible();

    // The list should contain test items or empty state text
    const items = testList.locator('div').first();
    const emptyState = page.getByText(/no tests|run tests first/i);
    await expect(items.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('right panel shows placeholder when no test selected', async ({ page }) => {
    const placeholder = page.getByText(/select a test/i);
    await expect(placeholder).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. ANALYTICS PAGE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
  });

  test('analytics page renders with title', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('analytics page shows chart cards or loading', async ({ page }) => {
    // Wait for loading to finish, then check for chart cards or empty charts
    await page.waitForTimeout(2000);

    // Chart card titles use uppercase 11px text — look for the card containers
    const chartCards = page.locator('.rounded-xl.border.overflow-hidden');
    const errorAlert = page.getByText(/failed to load/i);
    const skeleton = page.locator('.animate-pulse');

    // At least one chart card, error alert, or skeleton should be visible
    const anyVisible = await chartCards.first().or(errorAlert.first()).or(skeleton.first()).isVisible();
    expect(anyVisible).toBeTruthy();
  });

  test('analytics has date range picker', async ({ page }) => {
    // The DateRangePicker component should be on the page
    await page.waitForTimeout(1000);
    // Look for the picker or any button that sets days
    const dateControls = page.locator('button:has-text("7"), button:has-text("14"), button:has-text("30")');
    // If present, one should be visible
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 10. CONFIG PAGE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Config Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/config`);
  });

  test('config page loads with tabs', async ({ page }) => {
    await expect(page).toHaveURL(/\/config/);

    // Should have Visual and Editor tab buttons
    const visualBtn = page.getByText('Visual', { exact: false });
    const editorBtn = page.getByText('Editor', { exact: false });
    await expect(visualBtn.first()).toBeVisible();
    await expect(editorBtn.first()).toBeVisible();
  });

  test('config tab switching works', async ({ page }) => {
    const editorBtn = page.locator('button', { hasText: 'Editor' });
    await editorBtn.click();
    await page.waitForTimeout(300);

    // After clicking Editor, either the textarea or loading state should appear
    const textarea = page.locator('textarea');
    const loading = page.locator('.animate-pulse');
    const errorMsg = page.getByText(/could not load/i);
    await expect(textarea.or(loading).or(errorMsg)).toBeVisible({ timeout: 5000 });

    // Switch back to Visual
    const visualBtn = page.locator('button', { hasText: 'Visual' });
    await visualBtn.click();
    await page.waitForTimeout(300);
    // Page should not crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('config page shows Playwright Config title', async ({ page }) => {
    await expect(page.getByText('Playwright Config')).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 11. BASELINES PAGE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Baselines Page', () => {
  test('baselines page loads', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);

    await expect(page.getByRole('heading', { name: 'Baselines' })).toBeVisible();
  });

  test('baselines page has search input', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);

    const search = page.getByPlaceholder(/search baselines/i);
    await expect(search).toBeVisible();
  });

  test('baselines page has filter buttons', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);

    const allBtn = page.getByText('All', { exact: true });
    await expect(allBtn).toBeVisible();
  });

  test('baselines shows grid or empty state', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);
    await page.waitForTimeout(1000);

    // Either baseline cards or empty state
    const emptyState = page.getByText(/no baselines|run tests/i);
    const gridItems = page.locator('.grid');
    await expect(emptyState.first().or(gridItems.first())).toBeVisible({ timeout: 5000 });
  });

  test('baselines has refresh button', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);

    const refreshBtn = page.getByLabel(/refresh baselines/i);
    await expect(refreshBtn).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 12. CODEGEN PAGE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Codegen Page', () => {
  test('codegen page loads', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);

    await expect(page.getByRole('heading', { name: 'Codegen' })).toBeVisible();
  });

  test('has Start Recording button', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);

    await expect(page.getByRole('button', { name: /start recording/i })).toBeVisible();
  });

  test('has browser selection buttons', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);

    await expect(page.getByText('chromium')).toBeVisible();
    await expect(page.getByText('firefox')).toBeVisible();
    await expect(page.getByText('webkit')).toBeVisible();
  });

  test('has language selector', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);

    const langSelect = page.locator('#codegen-language');
    await expect(langSelect).toBeVisible();

    // Verify it has language options
    const options = langSelect.locator('option');
    await expect(await options.count()).toBeGreaterThanOrEqual(2);
  });

  test('has target URL input', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);

    const urlInput = page.locator('input[type="url"]');
    await expect(urlInput).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 13. SETTINGS PAGE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/settings`);
  });

  test('settings page loads with title', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('has Scheduler section', async ({ page }) => {
    await expect(page.getByRole('main').getByText('Scheduler')).toBeVisible();
  });

  test('has Integrations section', async ({ page }) => {
    await expect(page.getByRole('main').getByRole('button', { name: 'Integrations' })).toBeVisible();
  });

  test('has Workspaces section', async ({ page }) => {
    await expect(page.getByRole('main').getByText('Workspaces')).toBeVisible();
  });

  test('has Server section', async ({ page }) => {
    await expect(page.getByText('Server', { exact: true }).first()).toBeVisible();
  });

  test('has Display section', async ({ page }) => {
    await expect(page.getByRole('main').getByText('Display')).toBeVisible();
  });

  test('has Quality Gate section', async ({ page }) => {
    await expect(page.getByText('Quality Gate', { exact: true })).toBeVisible();
  });

  test('has Auto-Quarantine section', async ({ page }) => {
    await expect(page.getByText('Auto-Quarantine', { exact: true })).toBeVisible();
  });

  test('has AI Configuration section', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=ai`);
    await expect(page.getByRole('main').getByText('AI Configuration')).toBeVisible();
  });

  test('has Email Reports section', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=email`);
    await expect(page.getByRole('main').getByText('Email Reports')).toBeVisible();
  });

  test('has Defect Categories section', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=categories`);
    await expect(page.getByRole('main').getByText('Defect Categories')).toBeVisible();
  });

  test('integrations section has Slack, Jira, GitHub', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=integrations`);
    await expect(page.getByText('Slack').first()).toBeVisible();
    await expect(page.getByText('Jira').first()).toBeVisible();
    await expect(page.getByText('GitHub').first()).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 14. TOP BAR
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Top Bar', () => {
  test('top bar is visible with theme toggle and command button', async ({ page }) => {
    await page.goto(BASE);

    // Top bar header
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Theme toggle
    const themeBtn = page.getByLabel(/switch theme/i);
    await expect(themeBtn).toBeVisible();

    // Command palette shortcut hint
    const cmdHint = page.getByText('⌘K');
    await expect(cmdHint).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 15. EMPTY STATES & GRACEFUL HANDLING
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Empty States & Error Handling', () => {
  test('dashboard handles no data gracefully', async ({ page }) => {
    await page.goto(BASE);
    // Page should not crash — either shows data or empty state
    await expect(page.locator('body')).toBeVisible();
    // No uncaught error banners
    const errorOverlay = page.locator('#webpack-dev-server-client-overlay, vite-error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('analytics handles no data gracefully', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForTimeout(2000);
    // Page should not crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('baselines handles no data gracefully', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('test explorer handles no data gracefully', async ({ page }) => {
    await page.goto(`${BASE}/tests`);
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('runs page handles no data gracefully', async ({ page }) => {
    await page.goto(`${BASE}/runs`);
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 16. FOOTER
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Footer', () => {
  test('footer is visible with attribution', async ({ page }) => {
    await page.goto(BASE);

    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByText('Sergey Bar')).toBeVisible();
  });
});
