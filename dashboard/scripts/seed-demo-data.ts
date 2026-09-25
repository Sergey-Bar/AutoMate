#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../apps/server/data/dashboard.db');

console.log('🌱 Seeding Automate demo data...');
console.log(`📂 Database: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Utility functions
const generateCommitSha = () => randomBytes(20).toString('hex');
const generateFingerprint = () => randomBytes(6).toString('hex');
const toISOString = (date: Date) => date.toISOString();

// Date helpers — anchor to start of today (midnight UTC) for stable visual snapshots
const todayMidnight = new Date();
todayMidnight.setUTCHours(0, 0, 0, 0);
const now = new Date(todayMidnight.getTime() + 12 * 60 * 60 * 1000); // noon today
const yesterday = new Date(todayMidnight.getTime() - 12 * 60 * 60 * 1000); // noon yesterday
const twoDaysAgo = new Date(todayMidnight.getTime() - 36 * 60 * 60 * 1000);
const threeDaysAgo = new Date(todayMidnight.getTime() - 60 * 60 * 60 * 1000);
const sevenDaysAgo = new Date(todayMidnight.getTime() - 156 * 60 * 60 * 1000);

try {
  console.log('🧹 Cleaning up existing demo data...');
  
  // Delete in correct order (children before parents)
  db.exec(`
    DELETE FROM nl_query_history WHERE user_id = 'demo-user';
    DELETE FROM fingerprint_categories WHERE fingerprint LIKE 'demo%';
    DELETE FROM attachments WHERE id LIKE 'demo-%';
    DELETE FROM results WHERE id LIKE 'demo-%';
    DELETE FROM tests WHERE run_id LIKE 'demo-run-%';
    DELETE FROM suites WHERE id LIKE 'demo-%';
    DELETE FROM blob_shards WHERE id LIKE 'demo-%';
    DELETE FROM runs WHERE id LIKE 'demo-run-%';
    DELETE FROM quarantine WHERE id LIKE 'demo-%';
    DELETE FROM known_failures WHERE id LIKE 'demo-%';
    DELETE FROM schedules WHERE id LIKE 'demo-%';
    DELETE FROM workspaces WHERE id LIKE 'demo-%';
    DELETE FROM defect_categories WHERE id LIKE 'demo-%';
    DELETE FROM quality_gate_config WHERE id = 'global';
    DELETE FROM trends WHERE project IN ('chromium','firefox','webkit') AND branch = 'main';
  `);

  console.log('✅ Cleanup complete\n');

  // Prepared statements
  const insertRun = db.prepare(`
    INSERT OR IGNORE INTO runs (
      id, started_at, finished_at, status, total, passed, failed, flaky, skipped,
      duration_ms, branch, commit_sha, commit_message, triggered_by, config, raw_args,
      source, gate_status, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSuite = db.prepare(`
    INSERT OR IGNORE INTO suites (id, run_id, parent_id, title, file, project)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertTest = db.prepare(`
    INSERT OR IGNORE INTO tests (
      id, run_id, suite_id, title, file, line, column, stable_id, status,
      duration_ms, tags, annotations, retry_count, expected_status, worker_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResult = db.prepare(`
    INSERT OR IGNORE INTO results (
      id, test_id, run_id, retry, status, duration_ms, started_at,
      error_message, error_stack, worker_index, parallel_index,
      stdout, stderr, steps, attachments, fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAttachment = db.prepare(`
    INSERT OR IGNORE INTO attachments (
      id, result_id, name, content_type, path, size_bytes, thumbnail_path, is_screenshot_diff
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTrend = db.prepare(`
    INSERT OR IGNORE INTO trends (
      date, project, branch, total, passed, failed, flaky, avg_duration_ms, p95_duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertQuarantine = db.prepare(`
    INSERT OR IGNORE INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertKnownFailure = db.prepare(`
    INSERT OR IGNORE INTO known_failures (id, test_title, test_file, comment, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertSchedule = db.prepare(`
    INSERT OR IGNORE INTO schedules (id, cron_expr, run_options, enabled, last_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertWorkspace = db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, name, config_path, test_results_dir, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertQualityGate = db.prepare(`
    INSERT OR IGNORE INTO quality_gate_config (id, pass_rate_threshold, max_duration_ms, max_flaky_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertDefectCategory = db.prepare(`
    INSERT OR IGNORE INTO defect_categories (id, name, color, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const insertFingerprintCategory = db.prepare(`
    INSERT OR IGNORE INTO fingerprint_categories (fingerprint, category_id, assigned_at)
    VALUES (?, ?, ?)
  `);

  const insertBlobShard = db.prepare(`
    INSERT OR IGNORE INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertNlQuery = db.prepare(`
    INSERT OR IGNORE INTO nl_query_history (user_query, generated_sql, result_count, user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Transaction for bulk inserts
  const seedAll = db.transaction(() => {
    console.log('📦 Seeding workspaces (2)...');
    insertWorkspace.run(
      'demo-ws-1',
      'Main App',
      'playwright.config.ts',
      'test-results',
      toISOString(now)
    );
    insertWorkspace.run(
      'demo-ws-2',
      'API Tests',
      'api-tests/playwright.config.ts',
      'api-results',
      toISOString(now)
    );

    console.log('📦 Seeding defect categories (4)...');
    insertDefectCategory.run('demo-cat-timeout', 'Timeout', '#ef4444', toISOString(now));
    insertDefectCategory.run('demo-cat-selector', 'Selector Not Found', '#f59e0b', toISOString(now));
    insertDefectCategory.run('demo-cat-api', 'API Error', '#3b82f6', toISOString(now));
    insertDefectCategory.run('demo-cat-assertion', 'Assertion Failed', '#8b5cf6', toISOString(now));

    console.log('📦 Seeding quality gate config...');
    insertQualityGate.run('global', 95.0, 600000, 5, toISOString(now));

    console.log('📦 Seeding runs (5)...');
    const runs = [
      {
        id: 'demo-run-1',
        startedAt: new Date(now.getTime() - 285000),
        finishedAt: now,
        status: 'passed',
        total: 100,
        passed: 95,
        failed: 2,
        flaky: 2,
        skipped: 1,
        durationMs: 285000,
        branch: 'main',
        commitSha: generateCommitSha(),
        commitMessage: 'feat: implement user authentication flow',
        triggeredBy: 'ci',
        gateStatus: 'passed',
        workspaceId: 'demo-ws-1'
      },
      {
        id: 'demo-run-2',
        startedAt: new Date(yesterday.getTime() - 342000),
        finishedAt: yesterday,
        status: 'failed',
        total: 80,
        passed: 50,
        failed: 25,
        flaky: 3,
        skipped: 2,
        durationMs: 342000,
        branch: 'feature/login',
        commitSha: generateCommitSha(),
        commitMessage: 'fix: handle login timeout gracefully',
        triggeredBy: 'manual',
        gateStatus: 'failed',
        workspaceId: 'demo-ws-1'
      },
      {
        id: 'demo-run-3',
        startedAt: new Date(twoDaysAgo.getTime() - 180000),
        finishedAt: twoDaysAgo,
        status: 'passed',
        total: 60,
        passed: 60,
        failed: 0,
        flaky: 0,
        skipped: 0,
        durationMs: 180000,
        branch: 'main',
        commitSha: generateCommitSha(),
        commitMessage: 'chore: update dependencies',
        triggeredBy: 'schedule',
        gateStatus: 'passed',
        workspaceId: 'demo-ws-1'
      },
      {
        id: 'demo-run-4',
        startedAt: new Date(threeDaysAgo.getTime() - 120000),
        finishedAt: threeDaysAgo,
        status: 'interrupted',
        total: 40,
        passed: 20,
        failed: 5,
        flaky: 0,
        skipped: 0,
        durationMs: 120000,
        branch: 'develop',
        commitSha: generateCommitSha(),
        commitMessage: 'refactor: reorganize test structure',
        triggeredBy: 'ci',
        gateStatus: 'skipped',
        workspaceId: 'demo-ws-2'
      },
      {
        id: 'demo-run-5',
        startedAt: new Date(sevenDaysAgo.getTime() - 295000),
        finishedAt: sevenDaysAgo,
        status: 'passed',
        total: 100,
        passed: 98,
        failed: 1,
        flaky: 1,
        skipped: 0,
        durationMs: 295000,
        branch: 'main',
        commitSha: generateCommitSha(),
        commitMessage: 'test: add comprehensive API coverage',
        triggeredBy: 'ci',
        gateStatus: 'passed',
        workspaceId: 'demo-ws-1'
      }
    ];

    const config = JSON.stringify({ projects: ['chromium'], workers: 4 });
    const rawArgs = '--reporter=json --workers=4';

    runs.forEach((run) => {
      insertRun.run(
        run.id,
        toISOString(run.startedAt),
        toISOString(run.finishedAt),
        run.status,
        run.total,
        run.passed,
        run.failed,
        run.flaky,
        run.skipped,
        run.durationMs,
        run.branch,
        run.commitSha,
        run.commitMessage,
        run.triggeredBy,
        config,
        rawArgs,
        'live',
        run.gateStatus,
        run.workspaceId
      );
    });

    console.log('📦 Seeding suites (15)...');
    const suiteTemplates = [
      { suffix: 'auth', title: 'Auth Tests', file: 'tests/auth/login.spec.ts', project: 'chromium' },
      { suffix: 'dashboard', title: 'Dashboard Tests', file: 'tests/dashboard/overview.spec.ts', project: 'chromium' },
      { suffix: 'api', title: 'API Tests', file: 'tests/api/endpoints.spec.ts', project: 'firefox' }
    ];

    const suites: Array<{ id: string; runId: string; title: string; file: string; project: string }> = [];
    runs.forEach((run) => {
      suiteTemplates.forEach((template) => {
        const suiteId = `demo-suite-${run.id}-${template.suffix}`;
        suites.push({
          id: suiteId,
          runId: run.id,
          title: template.title,
          file: template.file,
          project: template.project
        });
        insertSuite.run(suiteId, run.id, null, template.title, template.file, template.project);
      });
    });

    console.log('📦 Seeding tests, results, and attachments...');
    
    const testTitles = [
      'should login with valid credentials',
      'should reject invalid password',
      'should display dashboard KPIs correctly',
      'should handle network timeout gracefully',
      'should validate form input errors',
      'should render chart data for last 30 days',
      'should export CSV report successfully',
      'should handle concurrent user sessions',
      'should refresh auth token automatically',
      'should display notification badges',
      'should filter table by date range',
      'should sort columns ascending and descending',
      'should paginate results correctly',
      'should search with autocomplete suggestions',
      'should upload files with progress indicator',
      'should delete items with confirmation modal',
      'should edit profile settings',
      'should change theme preference',
      'should display error boundaries on crash',
      'should handle browser back button navigation'
    ];

    const errorMessages = [
      'expect(received).toBeVisible()\n\nReceived element is not visible',
      'locator.click: Timeout 30000ms exceeded\n\nwaiting for locator(\'button[type="submit"]\')',
      'net::ERR_CONNECTION_REFUSED at https://api.example.com/users',
      'expect(received).toBe(expected)\n\nExpected: "success"\nReceived: "error"',
      'Navigation timeout of 30000ms exceeded',
      'Element is not attached to the DOM',
      'Cannot read property \'length\' of undefined at page.evaluate',
      'Request failed with status code 500'
    ];

    const errorStacks = [
      '    at Object.<anonymous> (tests/auth/login.spec.ts:45:20)',
      '    at runTest (node_modules/@playwright/test/lib/worker.js:234:15)',
      '    at async WorkerRunner._runTestWithRetries (node_modules/@playwright/test/lib/worker.js:189:7)'
    ].join('\n');

    let testCounter = 0;
    let resultCounter = 0;
    let attachmentCounter = 0;
    const fingerprints: string[] = [];

    runs.forEach((run, runIndex) => {
      const suitesForRun = suites.filter((s) => s.runId === run.id);
      let testsInRun = 0;
      let passedInRun = 0;
      let failedInRun = 0;
      let flakyInRun = 0;
      let skippedInRun = 0;

      suitesForRun.forEach((suite) => {
        const testsPerSuite = Math.ceil(run.total / 3);
        
        for (let i = 0; i < testsPerSuite && testsInRun < run.total; i++) {
          const testId = `demo-test-${testCounter}`;
          const stableId = `stable-${suite.title.toLowerCase().replace(/\s+/g, '-')}-${String(i).padStart(3, '0')}`;
          const title = testTitles[testCounter % testTitles.length];
          const line = 10 + i * 5;
          const workerIndex = testCounter % 8;

          let status: string;
          let tags: string;
          let retryCount: number;

          // Determine test status based on run stats
          if (skippedInRun < run.skipped) {
            status = 'skipped';
            tags = JSON.stringify(['@regression']);
            retryCount = 0;
            skippedInRun++;
          } else if (flakyInRun < run.flaky) {
            status = 'flaky';
            tags = JSON.stringify(['@smoke', '@flaky']);
            retryCount = 1;
            flakyInRun++;
          } else if (failedInRun < run.failed) {
            status = 'failed';
            tags = JSON.stringify(['@smoke']);
            retryCount = 0;
            failedInRun++;
          } else if (passedInRun < run.passed) {
            status = 'passed';
            tags = JSON.stringify(['@smoke', '@auth']);
            retryCount = 0;
            passedInRun++;
          } else {
            // If run was interrupted, some tests are queued
            if (run.status === 'interrupted' && testsInRun >= run.passed + run.failed + run.skipped + run.flaky) {
              status = 'queued';
              tags = JSON.stringify([]);
              retryCount = 0;
            } else {
              break; // No more tests needed for this suite
            }
          }

          const duration = status === 'queued' ? 0 : Math.floor(Math.random() * 5000) + 500;

          insertTest.run(
            testId,
            run.id,
            suite.id,
            title,
            suite.file,
            line,
            5,
            stableId,
            status,
            duration,
            tags,
            JSON.stringify([]),
            retryCount,
            'passed',
            workerIndex
          );

          // Create results
          if (status === 'passed') {
            const resultId = `demo-result-${resultCounter++}`;
            const steps = JSON.stringify([
              { title: 'Before Hooks', duration: 150 },
              { title: `navigate to ${suite.file}`, duration: 850 },
              { title: 'perform test action', duration: duration - 1000 }
            ]);
            insertResult.run(
              resultId,
              testId,
              run.id,
              0,
              'passed',
              duration,
              toISOString(new Date(run.startedAt.getTime() + testsInRun * 2000)),
              null,
              null,
              workerIndex,
              0,
              JSON.stringify([]),
              JSON.stringify([]),
              steps,
              JSON.stringify([]),
              null
            );
          } else if (status === 'failed') {
            const resultId = `demo-result-${resultCounter++}`;
            const fingerprint = `demo${generateFingerprint()}`;
            fingerprints.push(fingerprint);
            const errorMsg = errorMessages[failedInRun % errorMessages.length];
            const steps = JSON.stringify([
              { title: 'Before Hooks', duration: 150 },
              { title: `navigate to ${suite.file}`, duration: 850 }
            ]);
            insertResult.run(
              resultId,
              testId,
              run.id,
              0,
              'failed',
              duration,
              toISOString(new Date(run.startedAt.getTime() + testsInRun * 2000)),
              errorMsg,
              errorStacks,
              workerIndex,
              0,
              JSON.stringify([]),
              JSON.stringify([]),
              steps,
              JSON.stringify([]),
              fingerprint
            );

            // Add attachments for failed tests
            const screenshotId = `demo-attach-${attachmentCounter++}`;
            insertAttachment.run(
              screenshotId,
              resultId,
              'screenshot',
              'image/png',
              `test-results/${run.id}/${testId}/screenshot-${Date.now()}.png`,
              45678,
              null,
              0
            );

            const videoId = `demo-attach-${attachmentCounter++}`;
            insertAttachment.run(
              videoId,
              resultId,
              'video',
              'video/webm',
              `test-results/${run.id}/${testId}/video-${Date.now()}.webm`,
              2567890,
              null,
              0
            );

            const traceId = `demo-attach-${attachmentCounter++}`;
            insertAttachment.run(
              traceId,
              resultId,
              'trace',
              'application/zip',
              `test-results/${run.id}/${testId}/trace-${Date.now()}.zip`,
              856432,
              null,
              0
            );
          } else if (status === 'flaky') {
            // First attempt: failed
            const resultId1 = `demo-result-${resultCounter++}`;
            const fingerprint = `demo${generateFingerprint()}`;
            fingerprints.push(fingerprint);
            const errorMsg = errorMessages[flakyInRun % errorMessages.length];
            const steps = JSON.stringify([
              { title: 'Before Hooks', duration: 150 },
              { title: `navigate to ${suite.file}`, duration: 850 }
            ]);
            insertResult.run(
              resultId1,
              testId,
              run.id,
              0,
              'failed',
              duration,
              toISOString(new Date(run.startedAt.getTime() + testsInRun * 2000)),
              errorMsg,
              errorStacks,
              workerIndex,
              0,
              JSON.stringify([]),
              JSON.stringify([]),
              steps,
              JSON.stringify([]),
              fingerprint
            );

            // Add screenshot for flaky failure
            const screenshotId = `demo-attach-${attachmentCounter++}`;
            insertAttachment.run(
              screenshotId,
              resultId1,
              'screenshot',
              'image/png',
              `test-results/${run.id}/${testId}/screenshot-retry0-${Date.now()}.png`,
              43210,
              null,
              0
            );

            // Second attempt: passed
            const resultId2 = `demo-result-${resultCounter++}`;
            insertResult.run(
              resultId2,
              testId,
              run.id,
              1,
              'passed',
              duration - 200,
              toISOString(new Date(run.startedAt.getTime() + testsInRun * 2000 + duration + 500)),
              null,
              null,
              workerIndex,
              0,
              JSON.stringify([]),
              JSON.stringify([]),
              steps,
              JSON.stringify([]),
              null
            );
          } else if (status === 'skipped') {
            const resultId = `demo-result-${resultCounter++}`;
            insertResult.run(
              resultId,
              testId,
              run.id,
              0,
              'skipped',
              0,
              toISOString(new Date(run.startedAt.getTime() + testsInRun * 2000)),
              null,
              null,
              workerIndex,
              0,
              JSON.stringify([]),
              JSON.stringify([]),
              JSON.stringify([]),
              JSON.stringify([]),
              null
            );
          }

          testsInRun++;
          testCounter++;
        }
      });
    });

    console.log('📦 Seeding fingerprint categories (mapping failures to defect categories)...');
    const categories = ['demo-cat-timeout', 'demo-cat-selector', 'demo-cat-api', 'demo-cat-assertion'];
    fingerprints.slice(0, Math.min(10, fingerprints.length)).forEach((fp, idx) => {
      const categoryId = categories[idx % categories.length];
      insertFingerprintCategory.run(fp, categoryId, toISOString(now));
    });

    console.log('📦 Seeding trends (30 days × 3 projects)...');
    const projects = ['chromium', 'firefox', 'webkit'];
    const passRateStart = { chromium: 85, firefox: 80, webkit: 75 };
    const passRateEnd = { chromium: 95, firefox: 92, webkit: 90 };

    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const date = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];

      projects.forEach((project) => {
        const progressRatio = (30 - dayOffset) / 30; // 0 (30 days ago) to 1 (today)
        const passRate = passRateStart[project as keyof typeof passRateStart] + 
          (passRateEnd[project as keyof typeof passRateEnd] - passRateStart[project as keyof typeof passRateStart]) * progressRatio;
        
        const total = 100 + Math.floor(Math.random() * 20);
        const passed = Math.floor(total * (passRate / 100));
        const failed = Math.floor(total * ((100 - passRate - 3) / 100));
        const flaky = total - passed - failed;
        const avgDuration = 2500 + Math.random() * 500;
        const p95Duration = avgDuration * 1.8;

        insertTrend.run(
          dateStr,
          project,
          'main',
          total,
          passed,
          failed,
          flaky,
          avgDuration,
          p95Duration
        );
      });
    }

    console.log('📦 Seeding quarantine (3)...');
    insertQuarantine.run(
      'demo-quar-1',
      'should handle concurrent user sessions',
      'tests/auth/sessions.spec.ts',
      'Flaky due to race condition in session management - tracking in JIRA-234',
      toISOString(twoDaysAgo),
      'qa-team'
    );
    insertQuarantine.run(
      'demo-quar-2',
      'should refresh auth token automatically',
      'tests/auth/token.spec.ts',
      'Intermittent timeout on CI - needs investigation',
      toISOString(threeDaysAgo),
      'dev-team'
    );
    insertQuarantine.run(
      'demo-quar-3',
      'should upload files with progress indicator',
      'tests/dashboard/upload.spec.ts',
      'Random failures when network is slow - will fix after sprint',
      toISOString(sevenDaysAgo),
      'qa-lead'
    );

    console.log('📦 Seeding known failures (2)...');
    insertKnownFailure.run(
      'demo-known-1',
      'should display notification badges',
      'tests/dashboard/notifications.spec.ts',
      'Known issue with WebSocket disconnect - JIRA-456',
      toISOString(sevenDaysAgo),
      'product-team'
    );
    insertKnownFailure.run(
      'demo-known-2',
      'should handle browser back button navigation',
      'tests/navigation/history.spec.ts',
      'Expected failure in Safari due to browser limitation - JIRA-789',
      toISOString(threeDaysAgo),
      'qa-team'
    );

    console.log('📦 Seeding schedules (3)...');
    insertSchedule.run(
      'demo-sched-1',
      '0 2 * * *',
      JSON.stringify({ projects: ['chromium', 'firefox'], workers: 8 }),
      1,
      toISOString(now),
      toISOString(sevenDaysAgo)
    );
    insertSchedule.run(
      'demo-sched-2',
      '0 * * * *',
      JSON.stringify({ grep: '@smoke', workers: 4 }),
      1,
      toISOString(new Date(now.getTime() - 60 * 60 * 1000)),
      toISOString(sevenDaysAgo)
    );
    insertSchedule.run(
      'demo-sched-3',
      '0 6 * * 0',
      JSON.stringify({ grep: '@regression', workers: 16, retries: 2 }),
      1,
      toISOString(sevenDaysAgo),
      toISOString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    );

    console.log('📦 Seeding blob shards (2)...');
    insertBlobShard.run(
      'demo-blob-shard-1',
      'demo-run-1',
      1,
      2,
      'blob-storage/demo-run-1-shard-1.zip',
      toISOString(now),
      1
    );
    insertBlobShard.run(
      'demo-blob-shard-2',
      'demo-run-1',
      2,
      2,
      'blob-storage/demo-run-1-shard-2.zip',
      toISOString(now),
      1
    );

    console.log('📦 Seeding NL query history (3)...');
    insertNlQuery.run(
      'Show me all failed tests in the last 7 days',
      'SELECT * FROM tests WHERE status = \'failed\' AND run_id IN (SELECT id FROM runs WHERE started_at > datetime(\'now\', \'-7 days\'))',
      42,
      'demo-user',
      toISOString(yesterday)
    );
    insertNlQuery.run(
      'What is the pass rate trend for chromium project?',
      'SELECT date, (passed * 100.0 / total) as pass_rate FROM trends WHERE project = \'chromium\' AND branch = \'main\' ORDER BY date DESC LIMIT 30',
      30,
      'demo-user',
      toISOString(twoDaysAgo)
    );
    insertNlQuery.run(
      'Which tests are currently quarantined?',
      'SELECT test_title, test_file, reason, quarantined_by FROM quarantine ORDER BY quarantined_at DESC',
      3,
      'demo-user',
      toISOString(threeDaysAgo)
    );

    console.log('✅ All demo data seeded successfully!\n');
  });

  seedAll();

  // Print summary
  console.log('📊 Summary:');
  console.log(`   Runs:                 ${db.prepare('SELECT COUNT(*) as count FROM runs WHERE id LIKE ?').get('demo-run-%').count}`);
  console.log(`   Suites:               ${db.prepare('SELECT COUNT(*) as count FROM suites WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Tests:                ${db.prepare('SELECT COUNT(*) as count FROM tests WHERE run_id LIKE ?').get('demo-run-%').count}`);
  console.log(`   Results:              ${db.prepare('SELECT COUNT(*) as count FROM results WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Attachments:          ${db.prepare('SELECT COUNT(*) as count FROM attachments WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Trends:               ${db.prepare('SELECT COUNT(*) as count FROM trends WHERE project IN (?, ?, ?) AND branch = ?').get('chromium', 'firefox', 'webkit', 'main').count}`);
  console.log(`   Quarantine:           ${db.prepare('SELECT COUNT(*) as count FROM quarantine WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Known Failures:       ${db.prepare('SELECT COUNT(*) as count FROM known_failures WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Schedules:            ${db.prepare('SELECT COUNT(*) as count FROM schedules WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Workspaces:           ${db.prepare('SELECT COUNT(*) as count FROM workspaces WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Quality Gates:        ${db.prepare('SELECT COUNT(*) as count FROM quality_gate_config WHERE id = ?').get('global').count}`);
  console.log(`   Defect Categories:    ${db.prepare('SELECT COUNT(*) as count FROM defect_categories WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   Fingerprint Mappings: ${db.prepare('SELECT COUNT(*) as count FROM fingerprint_categories WHERE fingerprint LIKE ?').get('demo%').count}`);
  console.log(`   Blob Shards:          ${db.prepare('SELECT COUNT(*) as count FROM blob_shards WHERE id LIKE ?').get('demo-%').count}`);
  console.log(`   NL Query History:     ${db.prepare('SELECT COUNT(*) as count FROM nl_query_history WHERE user_id = ?').get('demo-user').count}`);
  
  console.log('🎉 Demo data is ready for Automate QA testing!');
  console.log('💡 Run the dashboard and explore all features with realistic data.\n');

} catch (error) {
  console.error('❌ Error seeding demo data:', error);
  process.exit(1);
} finally {
  db.close();
}
