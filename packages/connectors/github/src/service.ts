export interface RunSummary {
  status: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs?: number;
  branch?: string;
  dashboardUrl?: string;
  failedTests?: Array<{ title: string; file: string; errorMessage?: string }>;
}

export function buildSummaryMarkdown(run: RunSummary): string {
  const emoji = run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⚠️';
  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(1) : '0';
  const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : 'N/A';

  let body = `## ${emoji} Playwright Test Results\n\n`;
  body += '| Metric | Value |\n|---|---|\n';
  body += `| **Status** | ${run.status} |\n`;
  body += `| **Pass Rate** | ${passRate}% |\n`;
  body += `| **Total** | ${run.total} |\n`;
  body += `| **Passed** | ${run.passed} |\n`;
  body += `| **Failed** | ${run.failed} |\n`;
  body += `| **Flaky** | ${run.flaky} |\n`;
  body += `| **Skipped** | ${run.skipped} |\n`;
  body += `| **Duration** | ${duration} |\n`;
  body += `| **Branch** | ${run.branch ?? 'N/A'} |\n\n`;

  if (run.failedTests && run.failedTests.length > 0) {
    body += '### ❌ Failed Tests\n\n';
    body += '| Test | File | Error |\n|---|---|---|\n';
    for (const t of run.failedTests.slice(0, 20)) {
      const errMsg = t.errorMessage ? t.errorMessage.slice(0, 80).replace(/\|/g, '\\|').replace(/\n/g, ' ') : '—';
      body += `| ${t.title} | \`${t.file}\` | ${errMsg} |\n`;
    }

    if (run.failedTests.length > 20) {
      body += `\n_...and ${run.failedTests.length - 20} more failed tests_\n`;
    }
    body += '\n';
  }

  if (run.dashboardUrl) {
    body += `[📊 View in Dashboard](${run.dashboardUrl})\n\n`;
  }

  body += '---\n_Posted by Automate';
  return body;
}
