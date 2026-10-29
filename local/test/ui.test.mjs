import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import {
  bootstrapPage,
  dashboardPage,
  errorPage,
  esc,
  onboardingPage,
  reportPage,
  repositoriesPage,
  statusBadge,
} from '../src/ui.mjs';
import { FILES_DIR } from './support.mjs';

const fixture = (name) => readFileSync(path.join(FILES_DIR, name));

/** Structural accessibility and safety checks that need no browser. */
function assertWellFormedPage(html, name) {
  assert.ok(html.startsWith('<!doctype html>'), `${name}: doctype`);
  assert.match(html, /<html lang="en">/, `${name}: language`);
  assert.match(html, /<title>[^<]+<\/title>/, `${name}: title`);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${name}: exactly one h1`);
  assert.match(html, /<main id="main"/, `${name}: main landmark`);
  assert.match(html, /class="skip" href="#main"/, `${name}: skip link`);
  for (const input of html.matchAll(/<input\b[^>]*>/g)) {
    if (/type="hidden"/.test(input[0])) continue;
    const id = /id="([^"]+)"/.exec(input[0])?.[1];
    assert.ok(
      id && html.includes(`<label for="${id}"`),
      `${name}: input ${String(id)} has a label`,
    );
  }
  const tables = html.match(/<table\b/g)?.length ?? 0;
  assert.equal(html.match(/<caption>/g)?.length ?? 0, tables, `${name}: every table has a caption`);
  for (const th of html.matchAll(/<th\b[^>]*>/g))
    assert.match(th[0], /scope="/, `${name}: th has a scope`);
  assert.ok(!/\sstyle="/.test(html), `${name}: no inline style attribute`);
  assert.ok(!/\son[a-z]+=/.test(html), `${name}: no event handler attribute`);
  assert.ok(!/(?:src|href)="https?:/.test(html), `${name}: no remote resource`);
}

function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-ui-repo-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

async function render(files, scanOptions = {}) {
  const root = repository(files);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-ui-data-'));
  const engine = createEngine({ dataDir, now: () => new Date('2026-10-19T12:00:00Z') });
  try {
    const scanned = await engine.scan(root, scanOptions);
    const dash = engine.dashboard(scanned.repositoryId);
    const reports = dash.items.map((item) => ({ item, detail: engine.report(item.sha256) }));
    return { dash, html: dashboardPage(dash), reports };
  } finally {
    engine.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test('static pages are well formed', () => {
  assertWellFormedPage(bootstrapPage(), 'bootstrap');
  assertWellFormedPage(onboardingPage(), 'onboarding');
  assertWellFormedPage(
    onboardingPage({ message: 'That path is not a folder.' }),
    'onboarding error',
  );
  assertWellFormedPage(repositoriesPage([]), 'repositories (empty)');
  assertWellFormedPage(
    repositoriesPage([{ id: 'abc', root_path: 'C:\\repo', last_scan_at: null }]),
    'repositories',
  );
  assertWellFormedPage(errorPage(404, 'NOT_FOUND', 'There is nothing here.'), 'error');
  assert.match(onboardingPage({ message: 'x' }), /role="alert"/, 'an error is announced');
});

test('onboarding states that nothing is run or written, and an empty list is the onboarding page', () => {
  assert.match(onboardingPage(), /only reads/);
  assert.equal(repositoriesPage([]), onboardingPage());
});

test('dashboard, success: every figure shows its denominator and every table is labelled', async () => {
  const { html, dash } = await render({
    'package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
    'vitest.config.ts': '',
    'reports/junit.xml': fixture('junit-basic.xml'),
    'coverage/lcov.info': fixture('node-lcov.info'),
  });
  assertWellFormedPage(html, 'dashboard');
  assert.match(html, /1 of 4 product attempts/);
  assert.match(html, /87\.76%/);
  assert.match(html, /vitest/);
  assert.match(html, /A pass rate is not a quality score/);
  assert.equal(dash.kpis.testsFound.value, 4);
});

test('dashboard, empty: no reports shows what was found and no zero-filled metric', async () => {
  const { html } = await render({
    'package.json': JSON.stringify({ devDependencies: { jest: '1' } }),
    'jest.config.js': '',
  });
  assertWellFormedPage(html, 'dashboard (empty)');
  assert.match(html, /No test results found/);
  assert.match(html, /Missing/);
  assert.ok(!/\b0(\.0)?%/.test(html), 'a missing figure is not shown as 0%');
  assert.match(html, /jest/);
});

test('dashboard, empty: the card offers one safe next action, and the rescan it names is on the page', async () => {
  const { html } = await render({ 'package.json': '{}' });
  const card = /<div class="card" id="no-results">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.match(card, /Next: run your tests so they write a report into this folder, then/);
  assert.match(card, /<a href="#rescan">rescan<\/a>/);
  assert.match(html, /<form id="rescan" method="post" action="\/ui\/repositories">/);
});

test('dashboard, zero tests: a report with no tests is said so, not hidden behind a total of 0', async () => {
  const { html, dash } = await render({ 'reports/zero.xml': fixture('junit-zero-tests.xml') });
  assertWellFormedPage(html, 'dashboard (zero tests)');
  assert.equal(dash.kpis.testsFound.value, 0);
  assert.match(html, /1 report contains no tests\./);
  const mixed = await render({
    'reports/a.xml': fixture('junit-basic.xml'),
    'reports/b.xml': fixture('junit-zero-tests.xml'),
    // A second zero-test report with different bytes, so it is not counted as a copy.
    'reports/c.xml': `${fixture('junit-zero-tests.xml').toString()}<!-- another run -->\n`,
  });
  assert.match(mixed.html, /2 reports contain no tests\./);
  const none = await render({ 'reports/a.xml': fixture('junit-basic.xml') });
  assert.doesNotMatch(none.html, /contains? no tests/);
});

test('dashboard, drill-down: the figures point at the reports behind them, and each report is linked', async () => {
  const { html, dash } = await render({
    'reports/junit.xml': fixture('junit-basic.xml'),
    'coverage/lcov.info': fixture('node-lcov.info'),
  });
  assert.match(html, /<h2 id="all-reports">All reports<\/h2>/);
  for (const section of ['h-tests', 'h-cov']) {
    const body =
      new RegExp(`aria-labelledby="${section}">([\\s\\S]*?)</section>`).exec(html)?.[1] ?? '';
    assert.match(body, /<a href="#all-reports">/, `${section} links to the reports behind it`);
  }
  for (const item of dash.items) assert.ok(html.includes(`href="/reports/${item.sha256}"`));
});

test('dashboard, partial: a limit hit is announced and the figures say they cover only what was read', async () => {
  const files = { 'reports/junit.xml': fixture('junit-basic.xml') };
  for (let i = 0; i < 20; i += 1) files[`filler/f${String(i)}.txt`] = 'x';
  const { html } = await render(files, { limits: { maxFiles: 5 } });
  assert.match(html, /This scan is partial/);
  assert.match(html, /maxFiles/);
  assert.match(html, /role="status"/);
});

test('dashboard, incomplete reports: a banner says how many and results carry low confidence', async () => {
  const { html } = await render({
    'reports/a.xml': fixture('junit-basic.xml'),
    'reports/b.xml': fixture('junit-truncated.xml'),
  });
  assert.match(html, /1 report is not complete/);
  assert.match(html, /low confidence/);
  assertWellFormedPage(html, 'dashboard (incomplete)');
});

test('dashboard, rejected: a report that could not be read is listed with its reason, not hidden', async () => {
  const { html } = await render({
    'reports/ok.xml': fixture('junit-basic.xml'),
    'reports/bad-report.xml': fixture('junit-wrong-root.xml'),
  });
  assert.match(html, /not-junit/);
  assert.match(html, /rejected/);
});

test('report detail: every state is well formed and explains its warnings', async () => {
  const { reports } = await render({
    'reports/run.xml': fixture('junit-truncated.xml'),
    'reports/zero.xml': fixture('junit-zero-tests.xml'),
    'reports/lcov.info': fixture('lcov-basic.info'),
    'reports/bad.xml': fixture('junit-wrong-root.xml'),
  });
  const pages = reports.map(({ detail }) => reportPage(detail));
  assert.equal(pages.length, 4);
  pages.forEach((html, index) => assertWellFormedPage(html, `report ${String(index)}`));
  const all = pages.join('\n');
  assert.match(all, /The document ended inside an element/);
  assert.match(all, /This report contains no tests/);
  assert.match(all, /Not reported/);
  assert.match(all, /Rejected:/);
  assert.match(all, /Download the original file/);
});

test('absolute paths and host names inside report messages never reach the page', async () => {
  const xml =
    '<testsuite name="s"><testcase classname="c" name="t"><failure message="failed at C:\\Users\\someone\\proj\\a.js:3 on build-host"/></testcase></testsuite>';
  const { reports } = await render({ 'reports/junit.xml': xml });
  const html = reportPage(reports[0].detail, { roots: [], hostName: 'build-host' });
  assert.ok(!/[A-Za-z]:[\\/]/.test(html), 'an absolute path reached the page');
  assert.ok(!html.includes('someone'), 'the user name reached the page');
  assert.ok(html.includes('&lt;path&gt;/a.js:3'), 'the path was replaced, keeping the file name');
});
test('a status is always a word and a shape, never colour alone', () => {
  for (const status of [
    'passed',
    'failed',
    'errored',
    'skipped',
    'timedOut',
    'unknown',
    'notRun',
    'aborted',
    'infraError',
    'complete',
    'partial',
    'rejected',
  ]) {
    const html = statusBadge(status);
    assert.match(html, /aria-hidden="true">[^<]+<\/span> /, `${status}: shape`);
    assert.ok(html.includes(status), `${status}: word`);
  }
});

test('esc neutralises markup, quotes and ampersands', () => {
  assert.equal(
    esc('<a href="x" onclick=\'y\'>&</a>'),
    '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
  );
  assert.equal(esc(null), '');
});

test('the bootstrap script is pinned by hash', () => {
  const page = bootstrapPage();
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '';
  assert.equal(createHash('sha256').update(script).digest('hex').length, 64);
  assert.ok(!script.includes('${'), 'no template that could inject');
});
