/* global document, getComputedStyle -- page.evaluate bodies run in the browser */
import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { URL, URLSearchParams } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * R-020: every MVP-0 action is reachable by keyboard, and an automated accessibility check
 * reports no serious violations. Run in a real browser, because contrast and focus need a
 * layout that a string check of the HTML cannot see.
 *
 * The launcher is started for real and four folders are scanned through its API, so the
 * pages under test are the ones a person gets: a dashboard with results, one with nothing
 * found, one whose only report has no tests, one with a rejected report, and their reports.
 */

const LOCAL = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(LOCAL, 'bin', 'automate-local.mjs');
const FILES = path.join(LOCAL, 'corpus', 'files');
const fixture = (/** @type {string} */ name) => readFileSync(path.join(FILES, name));

/** @type {{ dir: string, child: import('node:child_process').ChildProcess, url: URL, token: string, pages: string[] }} */
let app;

/**
 * @param {number} port
 * @param {string} token
 * @param {string} method
 * @param {string} route
 * @param {string} [body]
 * @returns {Promise<any>}
 */
function api(port, token, method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: route,
        headers: {
          Host: `127.0.0.1:${String(port)}`,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve(text === '' ? null : JSON.parse(text)));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** @param {string} root @param {Record<string, Buffer | string>} files */
function folder(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

test.beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-a11y-'));
  const out = path.join(dir, 'serve.txt');
  const fd = openSync(out, 'w');
  const child = spawn(process.execPath, [BIN, 'serve', '--data-dir', path.join(dir, 'data')], {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  let address = '';
  for (let attempt = 0; attempt < 200 && address === ''; attempt += 1) {
    address =
      /running at (http:\/\/127\.0\.0\.1:\d+\/#t=\S+)/.exec(readFileSync(out, 'utf8'))?.[1] ?? '';
    if (address === '') await delay(50);
  }
  closeSync(fd);
  if (address === '')
    throw new Error(`the launcher printed no address: ${readFileSync(out, 'utf8')}`);
  const url = new URL(address);
  const port = Number(url.port);
  const token = new URLSearchParams(url.hash.slice(1)).get('t') ?? '';

  const folders = [
    folder(path.join(dir, 'results'), {
      'package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
      'reports/junit.xml': fixture('junit-basic.xml'),
      'reports/truncated.xml': fixture('junit-truncated.xml'),
      'coverage/lcov.info': fixture('node-lcov.info'),
    }),
    folder(path.join(dir, 'nothing'), { 'package.json': '{}' }),
    folder(path.join(dir, 'zero'), { 'reports/zero.xml': fixture('junit-zero-tests.xml') }),
    folder(path.join(dir, 'rejected'), { 'reports/bad.xml': fixture('junit-wrong-root.xml') }),
  ];
  const pages = ['/', '/runs', '/toolbox', '/findings'];
  for (const root of folders) {
    const { scanId } = await api(
      port,
      token,
      'POST',
      '/api/v1/repositories',
      JSON.stringify({ path: root }),
    );
    let operation;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      operation = await api(port, token, 'GET', `/api/v1/operations/${String(scanId)}`);
      if (operation.status !== 'running') break;
      await delay(25);
    }
    const id = operation.result.repositoryId;
    pages.push(`/repositories/${String(id)}`);
  }
  app = { dir, child, url, token, pages };
});

test.afterAll(async () => {
  app?.child.kill();
  await delay(200);
  if (app) rmSync(app.dir, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * Opens the printed address, which trades the token for a session cookie and reloads.
 *
 * @param {import('@playwright/test').Page} page
 */
async function signIn(page) {
  await page.goto(app.url.href);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('AUTOMATE (local)');
}

/**
 * Every page under test: the fixed ones, each dashboard, and every report the dashboards
 * link to.
 *
 * @param {import('@playwright/test').Page} page
 */
async function everyPage(page) {
  const found = new Set(app.pages);
  for (const dashboard of app.pages.filter((p) => p.startsWith('/repositories/'))) {
    await page.goto(new URL(dashboard, app.url).href);
    for (const href of await page
      .locator('a[href^="/reports/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? '')))
      found.add(href);
  }
  return [...found];
}

for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
  test(`no serious accessibility violation on any MVP-0 page, ${colorScheme} scheme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await signIn(page);
    const pages = await everyPage(page);
    expect(pages.filter((p) => p.startsWith('/reports/')).length).toBeGreaterThanOrEqual(5);
    const problems = [];
    for (const route of pages) {
      await page.goto(new URL(route, app.url).href);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      for (const violation of result.violations) {
        if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
        problems.push(
          `${route}: ${violation.id} (${String(violation.impact)}) on ${violation.nodes
            .map((node) => node.target.join(' '))
            .join(', ')}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
}

test('every action on a dashboard is reached by Tab, in order, with a visible focus', async ({
  page,
}) => {
  await signIn(page);
  const dashboard = app.pages.find((p) => p.startsWith('/repositories/')) ?? '';
  await page.goto(new URL(dashboard, app.url).href);
  const actions = await page
    .locator('a[href], button, input:not([type="hidden"]), select, textarea, summary')
    .evaluateAll((elements) =>
      elements
        .filter((element) => !element.closest('[hidden]'))
        .map((element) => element.outerHTML.slice(0, 80)),
    );
  expect(actions.length).toBeGreaterThan(8);
  expect(await page.locator('[tabindex]:not([tabindex="-1"])').count()).toBe(0);

  const reached = [];
  for (let press = 0; press < actions.length; press += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        html: element.outerHTML.slice(0, 80),
        visible: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2,
        onScreen: element.getBoundingClientRect().left >= 0,
      };
    });
    expect(focused, `Tab ${String(press + 1)} focused nothing`).not.toBeNull();
    expect(focused?.visible, `${String(focused?.html)} has no visible focus`).toBe(true);
    expect(focused?.onScreen, `${String(focused?.html)} is focused off screen`).toBe(true);
    reached.push(focused?.html);
  }
  expect(reached).toEqual(actions);
});

test('the skip link is the first stop and moves focus to the content', async ({ page }) => {
  await signIn(page);
  await page.goto(
    new URL(app.pages.find((p) => p.startsWith('/repositories/')) ?? '/', app.url).href,
  );
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Skip to content');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});
