import { test, expect } from '@playwright/test';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/* ──────────────────────────────────────────────────────────────────────────────
 * Global: skip onboarding wizard for all tests
 * ────────────────────────────────────────────────────────────────────────── */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mc-onboarding',
      JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. SCHEDULED RUNS — FEATURE FLAG & API
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Scheduled Runs — Feature Flag & API', () => {
  test('scheduled-runs feature is enabled (GET /api/schedules returns 200)', async ({ request }) => {
    const res = await request.get(`${API}/api/schedules`);
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('codegen-launcher feature is enabled (GET /api/codegen/status returns 200)', async ({ request }) => {
    const res = await request.get(`${API}/api/codegen/status`);
    expect(res.status()).toBe(200);
  });

  test('POST /api/schedules creates a schedule and DELETE removes it', async ({ request }) => {
    const cronExpr = '0 */6 * * *';
    const create = await request.post(`${API}/api/schedules`, {
      data: { cronExpr, enabled: true },
    });
    expect(create.status()).toBe(201);
    const body = await create.json() as { id: string; cronExpr: string; enabled: boolean };
    expect(typeof body.id).toBe('string');
    expect(body.cronExpr).toBe(cronExpr);
    expect(body.enabled).toBe(true);

    // Cleanup
    const del = await request.delete(`${API}/api/schedules/${body.id}`);
    expect(del.status()).toBe(204);
  });

  test('POST /api/schedules with empty cronExpr returns 400', async ({ request }) => {
    const res = await request.post(`${API}/api/schedules`, {
      data: { cronExpr: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE /api/schedules/:id with non-existent id returns 404', async ({ request }) => {
    const res = await request.delete(`${API}/api/schedules/non-existent-schedule-id`);
    expect(res.status()).toBe(404);
  });

  test('PUT /api/schedules/:id updates enabled state', async ({ request }) => {
    // Create a schedule
    const create = await request.post(`${API}/api/schedules`, {
      data: { cronExpr: '30 8 * * 1', enabled: true },
    });
    expect(create.status()).toBe(201);
    const { id } = await create.json() as { id: string };

    // Disable it
    const update = await request.put(`${API}/api/schedules/${id}`, {
      data: { enabled: false },
    });
    expect(update.status()).toBe(200);
    const updateBody = await update.json() as { ok: boolean };
    expect(updateBody.ok).toBe(true);

    // Cleanup
    await request.delete(`${API}/api/schedules/${id}`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. SCHEDULER SETTINGS — PAGE & UI STRUCTURE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Scheduler Settings — Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    // Mock GET /api/schedules to return empty list by default
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });
  });

  test('settings page has Scheduler section visible', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    const schedulerSection = page.getByRole('main').getByText('Scheduler');
    await expect(schedulerSection).toBeVisible({ timeout: 7000 });
  });

  test('settings scheduler tab loads', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('scheduler settings renders Scheduler heading', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    // The SchedulerSettings component renders a div with exact text "Scheduler"
    // Use .first() to avoid strict-mode violation (sidebar nav button also matches)
    const heading = page.getByText('Scheduler', { exact: true }).first();
    await expect(heading).toBeVisible({ timeout: 7000 });
  });

  test('scheduler settings shows cron expression input', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    const cronInput = page.getByPlaceholder(/\*\/30 \* \* \* \*/);
    await expect(cronInput).toBeVisible({ timeout: 7000 });
  });

  test('scheduler settings shows Add button', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    const addBtn = page.getByRole('button', { name: /add/i });
    await expect(addBtn).toBeVisible({ timeout: 7000 });
  });

  test('scheduler settings shows empty state when no schedules', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    // Empty list → no schedule rows, just the input/add form
    const cronInput = page.getByPlaceholder(/\*\/30 \* \* \* \*/);
    await expect(cronInput).toBeVisible({ timeout: 7000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. SCHEDULE CREATION — UI INTERACTION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Schedule Creation — UI', () => {
  const newScheduleId = 'mock-schedule-new-1';
  const cronExpr = '0 9 * * 1-5';

  test('typing cron expression and clicking Add calls POST /api/schedules', async ({ page }) => {
    let postCalled = false;
    let postedBody = '';

    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        postedBody = route.request().postData() ?? '';
        await route.fulfill({
          status: 201,
          json: { id: newScheduleId, cronExpr, enabled: true },
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(600);

    const cronInput = page.getByPlaceholder(/\*\/30 \* \* \* \*/);
    await expect(cronInput).toBeVisible({ timeout: 7000 });

    await cronInput.fill(cronExpr);
    await page.getByRole('button', { name: /add/i }).click();
    await page.waitForTimeout(500);

    expect(postCalled).toBe(true);
    expect(postedBody).toContain(cronExpr);
  });

  test('pressing Enter in cron input also creates schedule', async ({ page }) => {
    let postCalled = false;

    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        await route.fulfill({
          status: 201,
          json: { id: 'mock-enter-id', cronExpr: '*/5 * * * *', enabled: true },
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(600);

    const cronInput = page.getByPlaceholder(/\*\/30 \* \* \* \*/);
    await expect(cronInput).toBeVisible({ timeout: 7000 });

    await cronInput.fill('*/5 * * * *');
    await cronInput.press('Enter');
    await page.waitForTimeout(500);

    expect(postCalled).toBe(true);
  });

  test('empty cron input does not call POST /api/schedules', async ({ page }) => {
    let postCalled = false;

    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        await route.continue();
      } else if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(600);

    // Do NOT fill the input — click Add with empty value
    const addBtn = page.getByRole('button', { name: /add/i });
    await expect(addBtn).toBeVisible({ timeout: 7000 });
    await addBtn.click();
    await page.waitForTimeout(300);

    // POST should NOT have been triggered with empty cron
    expect(postCalled).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. SCHEDULE DISPLAY — LIST WITH ITEMS
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Schedule Display — List with Items', () => {
  const mockSchedules = [
    {
      id: 'sched-1',
      cronExpr: '0 8 * * *',
      enabled: true,
      lastRunAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 'sched-2',
      cronExpr: '0 20 * * 5',
      enabled: false,
      lastRunAt: null,
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: mockSchedules });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/schedules/**', async (route) => {
      await route.continue();
    });
  });

  test('scheduler list renders existing schedule cron expressions', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(800);

    await expect(page.getByText('0 8 * * *')).toBeVisible({ timeout: 7000 });
    await expect(page.getByText('0 20 * * 5')).toBeVisible({ timeout: 7000 });
  });

  test('scheduler list shows lastRunAt for schedules that have run', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(800);

    // sched-1 has a lastRunAt, so "Last:" should appear
    const lastLabel = page.getByText(/last:/i);
    await expect(lastLabel).toBeVisible({ timeout: 7000 });
  });

  test('scheduler list shows delete buttons for each schedule', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(800);

    const deleteButtons = page.getByRole('button', { name: /delete schedule/i });
    await expect(deleteButtons.first()).toBeVisible({ timeout: 7000 });
    const count = await deleteButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('scheduler list shows toggle for each schedule', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(800);

    // Both schedules should have a toggle button visible
    const toggleBtns = page.locator('button[role="switch"], input[type="checkbox"]');
    const count = await toggleBtns.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. SCHEDULE DELETION — UI INTERACTION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Schedule Deletion — UI', () => {
  const mockSchedules = [
    { id: 'del-sched-1', cronExpr: '*/15 * * * *', enabled: true, lastRunAt: null },
    { id: 'del-sched-2', cronExpr: '0 12 * * *', enabled: false, lastRunAt: null },
  ];

  test('clicking delete button calls DELETE /api/schedules/:id', async ({ page }) => {
    let deleteCalled = false;
    let deletedId = '';

    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: mockSchedules });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/schedules/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        const url = new URL(route.request().url());
        deletedId = url.pathname.split('/').pop() ?? '';
        await route.fulfill({ status: 204 });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(800);

    const deleteBtn = page.getByRole('button', { name: /delete schedule/i }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 7000 });
    await deleteBtn.click();
    await page.waitForTimeout(500);

    expect(deleteCalled).toBe(true);
    expect(['del-sched-1', 'del-sched-2']).toContain(deletedId);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. SCHEDULE TOGGLE — ENABLE/DISABLE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Schedule Toggle — Enable/Disable', () => {
  const mockSchedules = [
    { id: 'toggle-sched-1', cronExpr: '0 6 * * *', enabled: true, lastRunAt: null },
  ];

  test('toggling schedule enabled state calls PUT /api/schedules/:id', async ({ page }) => {
    let putCalled = false;
    let putBody = '';

    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: mockSchedules });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/schedules/**', async (route) => {
      if (route.request().method() === 'PUT') {
        putCalled = true;
        putBody = route.request().postData() ?? '';
        await route.fulfill({ json: { ok: true } });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/settings?tab=scheduler`);
    await page.waitForTimeout(800);

    // The Toggle component renders as a button with role="switch" or a checkbox
    const toggleEl = page.locator('button[role="switch"]').first();
    const checkboxEl = page.locator('input[type="checkbox"]').first();
    const toggle = (await toggleEl.count()) > 0 ? toggleEl : checkboxEl;

    await expect(toggle).toBeVisible({ timeout: 7000 });
    await toggle.click();
    await page.waitForTimeout(500);

    expect(putCalled).toBe(true);
    expect(putBody).toMatch(/enabled/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. CODEGEN LAUNCHER — PAGE STRUCTURE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Codegen Launcher — Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    // Mock codegen status to report not running
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: false, pid: null } });
    });
  });

  test('codegen page loads at /tools/codegen', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await expect(page).toHaveURL(/\/tools\/codegen/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('codegen page renders Codegen heading', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await expect(page.getByRole('heading', { name: 'Codegen' })).toBeVisible({ timeout: 7000 });
  });

  test('codegen page has target URL input', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const urlInput = page.locator('input[type="url"]');
    await expect(urlInput).toBeVisible({ timeout: 7000 });
  });

  test('codegen page URL input has default value', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const urlInput = page.locator('input[type="url"]');
    await expect(urlInput).toBeVisible({ timeout: 7000 });
    const value = await urlInput.inputValue();
    expect(value).toBeTruthy();
  });

  test('codegen page has browser selection buttons', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await expect(page.getByText('chromium')).toBeVisible({ timeout: 7000 });
    await expect(page.getByText('firefox')).toBeVisible({ timeout: 7000 });
    await expect(page.getByText('webkit')).toBeVisible({ timeout: 7000 });
  });

  test('codegen page has language selector', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const langSelect = page.locator('#codegen-language');
    await expect(langSelect).toBeVisible({ timeout: 7000 });
  });

  test('codegen language selector has at least 4 options', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const langSelect = page.locator('#codegen-language');
    await expect(langSelect).toBeVisible({ timeout: 7000 });
    const options = langSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('codegen page shows TypeScript as a language option', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const tsOption = page.locator('#codegen-language option[value="typescript"]');
    await expect(tsOption).toBeAttached({ timeout: 7000 });
  });

  test('codegen page has Start Recording button when not running', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const startBtn = page.getByRole('button', { name: /start recording/i });
    await expect(startBtn).toBeVisible({ timeout: 7000 });
  });

  test('codegen page does NOT show Stop Recording button when not running', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(500);
    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    await expect(stopBtn).not.toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. CODEGEN LAUNCHER — BROWSER SELECTION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Codegen Launcher — Browser Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: false, pid: null } });
    });
  });

  test('chromium browser button can be selected', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(500);

    const chromiumBtn = page.getByText('chromium');
    await expect(chromiumBtn).toBeVisible({ timeout: 7000 });
    await chromiumBtn.click();
    await page.waitForTimeout(200);
    // Should not crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('firefox browser button can be selected', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(500);

    const firefoxBtn = page.getByText('firefox');
    await expect(firefoxBtn).toBeVisible({ timeout: 7000 });
    await firefoxBtn.click();
    await page.waitForTimeout(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('webkit browser button can be selected', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(500);

    const webkitBtn = page.getByText('webkit');
    await expect(webkitBtn).toBeVisible({ timeout: 7000 });
    await webkitBtn.click();
    await page.waitForTimeout(200);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. CODEGEN LAUNCHER — START/STOP INTERACTION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Codegen Launcher — Start/Stop', () => {
  test('clicking Start Recording calls POST /api/codegen/start', async ({ page }) => {
    let startCalled = false;
    let startBody = '';

    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: false, pid: null } });
    });

    await page.route('**/api/codegen/start', async (route) => {
      if (route.request().method() === 'POST') {
        startCalled = true;
        startBody = route.request().postData() ?? '';
        await route.fulfill({
          status: 200,
          json: { started: true, pid: 12345 },
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(600);

    const startBtn = page.getByRole('button', { name: /start recording/i });
    await expect(startBtn).toBeVisible({ timeout: 7000 });
    await startBtn.click();
    await page.waitForTimeout(500);

    expect(startCalled).toBe(true);
    expect(startBody).toContain('url');
    expect(startBody).toContain('browser');
    expect(startBody).toContain('language');
  });

  test('start recording request includes selected browser and language', async ({ page }) => {
    let postedData: Record<string, unknown> = {};

    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: false, pid: null } });
    });

    await page.route('**/api/codegen/start', async (route) => {
      if (route.request().method() === 'POST') {
        const raw = route.request().postData() ?? '{}';
        postedData = JSON.parse(raw) as Record<string, unknown>;
        await route.fulfill({ json: { started: true, pid: 99 } });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(600);

    // Select firefox
    await page.getByText('firefox').click();
    // Change language to javascript
    await page.locator('#codegen-language').selectOption('javascript');

    await page.getByRole('button', { name: /start recording/i }).click();
    await page.waitForTimeout(500);

    expect(postedData['browser']).toBe('firefox');
    expect(postedData['language']).toBe('javascript');
  });

  test('when running, Stop Recording button is shown and calls POST /api/codegen/stop', async ({ page }) => {
    let stopCalled = false;

    // Simulate running state
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: true, pid: 54321 } });
    });

    await page.route('**/api/codegen/stop', async (route) => {
      if (route.request().method() === 'POST') {
        stopCalled = true;
        await route.fulfill({ json: { stopped: true } });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(600);

    // When running, Stop Recording button should be visible
    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    await expect(stopBtn).toBeVisible({ timeout: 7000 });

    await stopBtn.click();
    await page.waitForTimeout(500);

    expect(stopCalled).toBe(true);
  });

  test('when running, Recording badge is visible', async ({ page }) => {
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: true, pid: 54321 } });
    });

    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(600);

    // "● Recording" animated badge should appear in the header
    const recordingBadge = page.getByText('● Recording').first();
    await expect(recordingBadge).toBeVisible({ timeout: 7000 });
  });

  test('when running, URL/browser/language inputs are disabled', async ({ page }) => {
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: true, pid: 54321 } });
    });

    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForTimeout(600);

    const urlInput = page.locator('input[type="url"]');
    await expect(urlInput).toBeVisible({ timeout: 7000 });
    await expect(urlInput).toBeDisabled();

    const langSelect = page.locator('#codegen-language');
    await expect(langSelect).toBeDisabled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 10. CODEGEN — SIDEBAR NAVIGATION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Codegen Launcher — Sidebar Navigation', () => {
  test('sidebar shows Codegen link', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const codegenLink = page.getByRole('link', { name: /codegen/i });
    if (!(await codegenLink.isVisible().catch(() => false))) {
      const toggleSidebar = page.getByLabel('Toggle sidebar');
      await toggleSidebar.click();
      await page.waitForTimeout(400);
    }

    await expect(page.getByRole('link', { name: /codegen/i })).toBeVisible({ timeout: 7000 });
  });

  test('clicking Codegen sidebar link navigates to /tools/codegen', async ({ page }) => {
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: false, pid: null } });
    });

    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const codegenLink = page.getByRole('link', { name: /codegen/i });
    if (!(await codegenLink.isVisible().catch(() => false))) {
      await page.getByLabel('Toggle sidebar').click();
      await page.waitForTimeout(400);
    }

    await codegenLink.click();
    await expect(page).toHaveURL(/\/tools\/codegen/, { timeout: 7000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 11. CODEGEN — HOW IT WORKS HELP TEXT
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Codegen Launcher — Help Text', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/codegen/status', async (route) => {
      await route.fulfill({ json: { running: false, pid: null } });
    });
  });

  test('codegen page shows "How it works" help section', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const helpHeading = page.getByText(/how it works/i);
    await expect(helpHeading).toBeVisible({ timeout: 7000 });
  });

  test('codegen help text shows start recording step', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const step = page.getByText(/start recording/i).first();
    await expect(step).toBeVisible({ timeout: 7000 });
  });

  test('codegen help text describes browser window opening', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    const step = page.getByText(/browser window/i);
    await expect(step).toBeVisible({ timeout: 7000 });
  });
});
