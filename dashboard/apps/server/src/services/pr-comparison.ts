import { db, poolConnection } from '../db/client.js';
import { runs, tests, results, quarantine } from '../db/schema.js';
import { eq, and, desc, inArray } from 'drizzle-orm';

export interface PRComparisonResult {
  newFailures: Array<{ stableId: string; title: string; file: string; error?: string }>;
  fixedTests: Array<{ stableId: string; title: string; file: string }>;
  newTests: Array<{ stableId: string; title: string; file: string; status: string }>;
  flakyIgnored: Array<{ stableId: string; title: string; file: string }>;
  summary: {
    totalPrTests: number;
    totalBaseTests: number;
    newFailureCount: number;
    fixedCount: number;
    newTestCount: number;
  };
}

type TestRow = { stable_id: string | null; title: string; file: string; status: string };

export async function resolveBaseRun(baseBranch: string, workspaceId?: string): Promise<string | null> {
  const filters = [
    inArray(runs.status, ['passed', 'failed']),
    eq(runs.branch, baseBranch),
  ];

  if (workspaceId) {
    filters.push(eq(runs.workspaceId, workspaceId));
  }

  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(...filters))
    .orderBy(desc(runs.startedAt))
    .limit(1);

  return rows[0]?.id ?? null;
}

export async function compareRunToBase(
  prRunId: string,
  baseRunId: string,
  options?: { ignoreQuarantined?: boolean },
): Promise<PRComparisonResult> {
  const prTestsResult = await poolConnection.query(
    'SELECT stable_id, title, file, status FROM tests WHERE run_id = $1',
    [prRunId],
  );
  const prTests = prTestsResult.rows as TestRow[];

  const baseTestsResult = await poolConnection.query(
    'SELECT stable_id, title, file, status FROM tests WHERE run_id = $1',
    [baseRunId],
  );
  const baseTests = baseTestsResult.rows as TestRow[];

  const key = (t: TestRow) => t.stable_id ?? `${t.file}::${t.title}`;
  const PASS = new Set(['passed', 'flaky', 'skipped']);

  const baseMap = new Map(baseTests.map((t) => [key(t), t]));

  const newFailures: Array<{ stableId: string; title: string; file: string; error?: string }> = [];
  const fixedTests: Array<{ stableId: string; title: string; file: string }> = [];
  const newTests: Array<{ stableId: string; title: string; file: string; status: string }> = [];
  const flakyIgnored: Array<{ stableId: string; title: string; file: string }> = [];

  for (const prTest of prTests) {
    const k = key(prTest);
    const baseTest = baseMap.get(k);

    if (!baseTest) {
      newTests.push({
        stableId: k,
        title: prTest.title,
        file: prTest.file,
        status: prTest.status,
      });
      continue;
    }

    const basePass = PASS.has(baseTest.status);
    const prPass = PASS.has(prTest.status);

    if (basePass && !prPass) {
      newFailures.push({
        stableId: k,
        title: prTest.title,
        file: prTest.file,
      });
    } else if (!basePass && prPass) {
      fixedTests.push({
        stableId: k,
        title: prTest.title,
        file: prTest.file,
      });
    }
  }

  if (newFailures.length > 0) {
    const failureStableIds = newFailures.map((t) => t.stableId);
    const errorRows = await db
      .select({
        stableId: tests.stableId,
        title: tests.title,
        file: tests.file,
        errorMessage: results.errorMessage,
      })
      .from(results)
      .innerJoin(tests, and(eq(results.testId, tests.id), eq(results.runId, tests.runId)))
      .where(and(eq(results.runId, prRunId), inArray(tests.stableId, failureStableIds)));

    const errorByStableId = new Map<string, string>();
    for (const row of errorRows) {
      if (!row.stableId || !row.errorMessage || errorByStableId.has(row.stableId)) continue;
      errorByStableId.set(row.stableId, row.errorMessage);
    }

    for (const failure of newFailures) {
      const message = errorByStableId.get(failure.stableId);
      if (message) failure.error = message;
    }
  }

  if (options?.ignoreQuarantined) {
    const quarantinedRows = await db
      .select({ title: quarantine.testTitle, file: quarantine.testFile })
      .from(quarantine)
      .where(eq(quarantine.status, 'approved'));
    const quarantinedSet = new Set(quarantinedRows.map((q) => `${q.file}::${q.title}`));

    const retainedFailures: Array<{ stableId: string; title: string; file: string; error?: string }> = [];
    for (const failure of newFailures) {
      const qKey = `${failure.file}::${failure.title}`;
      if (quarantinedSet.has(qKey)) {
        flakyIgnored.push({
          stableId: failure.stableId,
          title: failure.title,
          file: failure.file,
        });
      } else {
        retainedFailures.push(failure);
      }
    }

    newFailures.splice(0, newFailures.length, ...retainedFailures);
  }

  return {
    newFailures,
    fixedTests,
    newTests,
    flakyIgnored,
    summary: {
      totalPrTests: prTests.length,
      totalBaseTests: baseTests.length,
      newFailureCount: newFailures.length,
      fixedCount: fixedTests.length,
      newTestCount: newTests.length,
    },
  };
}

export function generatePrCommentMarkdown(
  comparison: PRComparisonResult,
  meta: { prNumber: number; runId: string; dashboardUrl?: string },
): string {
  const { newFailures, fixedTests, newTests, flakyIgnored, summary } = comparison;
  const emoji = newFailures.length > 0 ? '❌' : '✅';

  let md = `## ${emoji} Playwright PR Test Report\n\n`;
  md += `| Metric | Count |\n|---|---|\n`;
  md += `| Tests in PR | ${summary.totalPrTests} |\n`;
  md += `| Tests in Base | ${summary.totalBaseTests} |\n`;
  md += `| New Failures | ${summary.newFailureCount} |\n`;
  md += `| Fixed Tests | ${summary.fixedCount} |\n`;
  md += `| New Tests | ${summary.newTestCount} |\n\n`;

  if (newFailures.length > 0) {
    md += `### ❌ New Failures\n\n`;
    md += `| Test | File | Error |\n|---|---|---|\n`;
    for (const t of newFailures.slice(0, 20)) {
      const err = t.error ? t.error.slice(0, 80).replace(/\|/g, '\\|').replace(/\n/g, ' ') : '—';
      md += `| ${t.title} | \`${t.file}\` | ${err} |\n`;
    }
    if (newFailures.length > 20) {
      md += `\n_...and ${newFailures.length - 20} more_\n`;
    }
    md += '\n';
  }

  if (fixedTests.length > 0) {
    md += `### ✅ Fixed Tests\n\n`;
    md += `| Test | File |\n|---|---|\n`;
    for (const t of fixedTests.slice(0, 10)) {
      md += `| ${t.title} | \`${t.file}\` |\n`;
    }
    if (fixedTests.length > 10) {
      md += `\n_...and ${fixedTests.length - 10} more_\n`;
    }
    md += '\n';
  }

  if (newTests.length > 0) {
    md += `### 🆕 New Tests\n\n`;
    md += `| Test | File | Status |\n|---|---|---|\n`;
    for (const t of newTests.slice(0, 10)) {
      md += `| ${t.title} | \`${t.file}\` | ${t.status} |\n`;
    }
    if (newTests.length > 10) {
      md += `\n_...and ${newTests.length - 10} more_\n`;
    }
    md += '\n';
  }

  if (flakyIgnored.length > 0) {
    md += `### ⚠️ Quarantined (Ignored)\n\n`;
    md += `| Test | File |\n|---|---|\n`;
    for (const t of flakyIgnored) {
      md += `| ${t.title} | \`${t.file}\` |\n`;
    }
    md += '\n';
  }

  if (newFailures.length === 0) {
    md += `> ✅ No new test failures introduced in this PR.\n\n`;
  }

  if (meta.dashboardUrl) {
    md += `[📊 View in Dashboard](${meta.dashboardUrl}/runs/${meta.runId})\n\n`;
  }

  md += `---\n_Posted by Automate`;
  return md;
}
