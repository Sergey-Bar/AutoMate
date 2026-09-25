import { poolConnection } from '../db/client.js';

interface RunRow {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  duration_ms: number | null;
  branch: string | null;
  commit_sha: string | null;
  gate_status: string | null;
}

interface TestRow {
  title: string;
  file: string;
  status: string;
  duration_ms: number | null;
  retry_count: number;
  error_message: string | null;
}

export async function generateHtmlReport(runId: string): Promise<string> {
  const runResult = await poolConnection.query(
    `SELECT id, status, started_at, finished_at, total, passed, failed, flaky, skipped, duration_ms, branch, commit_sha, gate_status FROM runs WHERE id = $1`,
    [runId],
  );
  const run = runResult.rows[0] as RunRow | undefined;

  if (!run) throw new Error(`Run ${runId} not found`);

  const testsResult = await poolConnection.query(
    `SELECT t.title, t.file, t.status, t.duration_ms, t.retry_count,
            r.error_message
     FROM tests t
     LEFT JOIN results r ON r.test_id = t.id AND r.run_id = t.run_id AND r.retry = 0
     WHERE t.run_id = $1
     ORDER BY
       CASE t.status
         WHEN 'failed' THEN 0
         WHEN 'timedOut' THEN 1
         WHEN 'flaky' THEN 2
         WHEN 'passed' THEN 3
         WHEN 'skipped' THEN 4
         ELSE 5
       END,
       t.file, t.title`,
    [runId],
  );
  const tests = testsResult.rows as TestRow[];

  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(1) : '0.0';
  const duration = run.duration_ms ? formatMs(run.duration_ms) : 'N/A';
  const startDate = new Date(run.started_at).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const statusColor = (s: string) => {
    switch (s) {
      case 'passed': return '#34d399';
      case 'failed': case 'timedOut': return '#f87171';
      case 'flaky': return '#fbbf24';
      case 'skipped': return '#94a3b8';
      default: return '#6b7280';
    }
  };

  const escHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const testRows = tests.map((t) => `
    <tr>
      <td><span class="badge" style="background:${statusColor(t.status)}">${escHtml(t.status)}</span></td>
      <td class="test-name">${escHtml(t.title)}<br><span class="file-path">${escHtml(t.file)}</span></td>
      <td class="mono">${t.duration_ms ? formatMs(t.duration_ms) : '-'}</td>
      <td>${t.retry_count ?? 0}</td>
      <td class="error">${t.error_message ? escHtml(t.error_message.slice(0, 200)) : ''}</td>
    </tr>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Run Report — ${escHtml(run.id.slice(0, 8))}</title>
  <style>
    :root { --bg: #0f1117; --surface: #1a1d27; --elevated: #252833; --text: #f0f0f0; --text2: #a0a0a0; --text3: #666; --border: rgba(255,255,255,0.08); --pass: #34d399; --fail: #f87171; --flaky: #fbbf24; --skip: #94a3b8; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 32px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: var(--text2); font-size: 13px; margin-bottom: 24px; }
    .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; min-width: 140px; }
    .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text3); margin-bottom: 4px; }
    .kpi-value { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .gate { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .gate-passed { background: rgba(52,211,153,0.15); color: var(--pass); }
    .gate-failed { background: rgba(248,113,113,0.15); color: var(--fail); }
    .gate-skipped { background: rgba(148,163,184,0.15); color: var(--skip); }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; background: var(--surface); border-radius: 8px; overflow: hidden; }
    thead th { text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text3); border-bottom: 1px solid var(--border); background: var(--elevated); }
    tbody td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: rgba(255,255,255,0.02); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #000; }
    .test-name { font-weight: 500; }
    .file-path { font-size: 11px; color: var(--text3); font-family: monospace; }
    .mono { font-family: monospace; font-size: 12px; }
    .error { font-size: 11px; color: var(--fail); font-family: monospace; max-width: 300px; word-break: break-all; }
    .footer { margin-top: 32px; text-align: center; font-size: 11px; color: var(--text3); }
    @media print { body { background: #fff; color: #000; } .kpi { border-color: #ddd; } table { background: #fff; } thead th { background: #f5f5f5; color: #333; } tbody td { color: #000; } }
  </style>
</head>
<body>
  <h1>Test Run Report</h1>
  <div class="subtitle">
    Run ${escHtml(run.id.slice(0, 8))} · ${startDate}
    ${run.branch ? ` · Branch: ${escHtml(run.branch)}` : ''}
    ${run.commit_sha ? ` · Commit: ${escHtml(run.commit_sha.slice(0, 7))}` : ''}
    ${run.gate_status ? ` · <span class="gate gate-${run.gate_status}">${run.gate_status}</span>` : ''}
  </div>

  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value">${run.total}</div></div>
    <div class="kpi"><div class="kpi-label">Passed</div><div class="kpi-value" style="color:var(--pass)">${run.passed}</div></div>
    <div class="kpi"><div class="kpi-label">Failed</div><div class="kpi-value" style="color:${run.failed > 0 ? 'var(--fail)' : 'var(--text)'}">${run.failed}</div></div>
    <div class="kpi"><div class="kpi-label">Flaky</div><div class="kpi-value" style="color:${run.flaky > 0 ? 'var(--flaky)' : 'var(--text)'}">${run.flaky}</div></div>
    <div class="kpi"><div class="kpi-label">Skipped</div><div class="kpi-value">${run.skipped}</div></div>
    <div class="kpi"><div class="kpi-label">Pass Rate</div><div class="kpi-value">${passRate}%</div></div>
    <div class="kpi"><div class="kpi-label">Duration</div><div class="kpi-value">${duration}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Status</th>
        <th>Test</th>
        <th>Duration</th>
        <th>Retries</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>
      ${testRows}
    </tbody>
  </table>

  <div class="footer">
    Generated by Mission Control · ${new Date().toISOString()}
  </div>
</body>
</html>`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
