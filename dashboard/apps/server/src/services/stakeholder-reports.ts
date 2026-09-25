/**
 * stakeholder-reports.ts — Stakeholder-specific PDF report templates.
 *
 * Templates:
 *   release     Gate status, pass rate, new failures, regressions (for PM/EM)
 *   quality     Trends, top flaky, top slow, failure categories (for QA Lead)
 *   executive   Quality trend, flaky cost estimate, quarantine ROI (for Exec)
 *
 * All templates use pdfkit and query the database directly via the shared
 * sqlite client, following the same pattern as pdf-report.ts.
 */
import PDFDocument from 'pdfkit';
import { poolConnection } from '../db/client.js';

export type ReportTemplate = 'release' | 'quality' | 'executive';

export const VALID_TEMPLATES: readonly ReportTemplate[] = ['release', 'quality', 'executive'] as const;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function pdfSectionHeader(doc: InstanceType<typeof PDFDocument>, title: string): void {
  doc.moveDown(0.8);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000').text(title);
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

function pdfKpis(
  doc: InstanceType<typeof PDFDocument>,
  kpis: Array<{ label: string; value: string; color?: string }>,
): void {
  const kpiY = doc.y;
  const kpiWidth = 75;
  const kpiStartX = 50;
  const perRow = Math.min(kpis.length, 7);
  for (let i = 0; i < kpis.length; i++) {
    const kpi = kpis[i];
    if (!kpi) continue;
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = kpiStartX + col * kpiWidth;
    const y = kpiY + row * 38;
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af').text(kpi.label.toUpperCase(), x, y, { width: kpiWidth, align: 'center' });
    doc.fontSize(13).font('Helvetica-Bold').fillColor(kpi.color ?? '#111827').text(kpi.value, x, y + 10, { width: kpiWidth, align: 'center' });
  }
  const rows = Math.ceil(kpis.length / perRow);
  doc.y = kpiY + rows * 38 + 4;
}

function pdfTable(
  doc: InstanceType<typeof PDFDocument>,
  columns: Array<{ header: string; width: number; x: number }>,
  rows: Array<Array<{ text: string; color?: string }>>,
): void {
  // Header
  const headerY = doc.y;
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#6b7280');
  for (const col of columns) {
    doc.text(col.header, col.x, headerY, { width: col.width });
  }
  doc.y = headerY + 11;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').lineWidth(0.4).stroke();
  doc.moveDown(0.2);

  // Rows
  for (const row of rows) {
    if (doc.y > 760) doc.addPage();
    const rowY = doc.y;
    doc.fontSize(7).font('Helvetica');
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const cell = row[i];
      if (!col || !cell) continue;
      doc.fillColor(cell.color ?? '#111827').text(cell.text, col.x, rowY, { width: col.width });
    }
    doc.y = rowY + 12;
  }
}

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
  commit_message: string | null;
  gate_status: string | null;
  workspace_id: string | null;
}

// ─── Release Report ───────────────────────────────────────────────────────────

export async function generateReleaseReport(runId: string): Promise<Buffer> {
  const runResult = await poolConnection.query(
    'SELECT * FROM runs WHERE id = $1',
    [runId],
  );
  const run = runResult.rows[0] as RunRow;
  if (!run) throw new Error(`Run ${runId} not found`);

  const newFailuresResult = await poolConnection.query(
    `SELECT t.title, t.file
     FROM tests t
     JOIN runs r ON t.run_id = r.id
     WHERE r.id = $1 AND r.status = 'failed'
     AND t.id NOT IN (
       SELECT id FROM tests WHERE run_id != $1
     )`,
    [runId],
  );
  const newFailures = newFailuresResult.rows as Array<{ title: string; file: string }>;

  const quarantinedResult = await poolConnection.query(
    "SELECT COUNT(*) AS cnt FROM quarantine WHERE status = 'approved'",
  );
  const quarantinedCount = Number((quarantinedResult.rows[0] as { cnt: string | number }).cnt);

  const passRate = run.total > 0 ? (run.passed / run.total) * 100 : 0;
  const startDate = new Date(run.started_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#111827').text('Release Report', { align: 'center' });
    doc.moveDown(0.25);
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
      .text(`Run ${run.id.slice(0, 8)} · ${startDate}${run.branch ? ` · ${run.branch}` : ''}${run.commit_sha ? ` · ${run.commit_sha.slice(0, 7)}` : ''}`, { align: 'center' });
    doc.moveDown(0.6);

    const gateColor = run.gate_status === 'passed' ? '#16a34a' : run.gate_status === 'failed' ? '#dc2626' : '#6b7280';
    pdfKpis(doc, [
      { label: 'Gate', value: (run.gate_status ?? 'N/A').toUpperCase(), color: gateColor },
      { label: 'Pass Rate', value: `${passRate.toFixed(1)}%` },
      { label: 'Total Tests', value: String(run.total) },
      { label: 'Failed', value: String(run.failed), color: run.failed > 0 ? '#dc2626' : '#111827' },
      { label: 'Flaky', value: String(run.flaky), color: run.flaky > 0 ? '#d97706' : '#111827' },
      { label: 'Quarantined', value: String(quarantinedCount) },
      { label: 'Duration', value: run.duration_ms ? formatMs(run.duration_ms) : 'N/A' },
    ]);

    pdfSectionHeader(doc, `Failures (${newFailures.length}${newFailures.length === 50 ? '+' : ''})`);
    if (newFailures.length === 0) {
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('No failures in this run. ✅');
    } else {
      pdfTable(doc,
        [
          { header: 'TEST', width: 220, x: 50 },
          { header: 'FILE', width: 200, x: 275 },
          { header: 'ERROR', width: 65, x: 480 },
        ],
        newFailures.map((t) => [
          { text: truncate(t.title, 40) },
          { text: truncate(t.file, 35), color: '#6b7280' },
          { text: t.error_message ? truncate(t.error_message, 12) : '-', color: '#9ca3af' },
        ]),
      );
    }

    if (run.commit_message) {
      pdfSectionHeader(doc, 'Commit');
      doc.fontSize(8).font('Helvetica').fillColor('#374151').text(truncate(run.commit_message, 180));
    }

    doc.moveDown(2);
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af').text(`Automate · ${new Date().toISOString()}`, { align: 'center' });
    doc.end();
  });
}

// ─── Quality Report ───────────────────────────────────────────────────────────

export async function generateQualityReport(runId: string): Promise<Buffer> {
  const runResult = await poolConnection.query(
    `SELECT id, status, started_at, finished_at, total, passed, failed, flaky, skipped,
            duration_ms, branch, commit_sha, gate_status, workspace_id
     FROM runs WHERE id = $1`,
    [runId],
  );
  const run = runResult.rows[0] as RunRow | undefined;
  if (!run) throw new Error(`Run ${runId} not found`);

  const passRate = run.total > 0 ? (run.passed / run.total) * 100 : 0;
  const startDate = new Date(run.started_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  // Top 10 flakiest tests (most retries in this run)
  const flakyTestsResult = await poolConnection.query(
    `SELECT title, file, retry_count, duration_ms, status
     FROM tests
     WHERE run_id = $1 AND retry_count > 0
     ORDER BY retry_count DESC, duration_ms DESC
     LIMIT 10`,
    [runId],
  );
  const flakyTests = flakyTestsResult.rows as Array<{ title: string; file: string; retry_count: number; duration_ms: number | null; status: string }>;

  // Top 10 slowest tests
  const slowTestsResult = await poolConnection.query(
    `SELECT title, file, duration_ms, status
     FROM tests
     WHERE run_id = $1 AND duration_ms IS NOT NULL
     ORDER BY duration_ms DESC
     LIMIT 10`,
    [runId],
  );
  const slowTests = slowTestsResult.rows as Array<{ title: string; file: string; duration_ms: number; status: string }>;

  // Failure categories from error clustering (top 5)
  const failureCatsResult = await poolConnection.query(
    `SELECT dc.name, dc.color, COUNT(fc.fingerprint) AS cnt
     FROM fingerprint_categories fc
     JOIN defect_categories dc ON dc.id = fc.category_id
     GROUP BY dc.id, dc.name, dc.color
     ORDER BY cnt DESC
     LIMIT 5`,
  );
  const failureCats = failureCatsResult.rows as Array<{ name: string; color: string; cnt: string | number }>;

  // 30-day trend (last 30 trend rows)
  const trendsResult = await poolConnection.query(
    `SELECT date, SUM(total) AS total, SUM(passed) AS passed, SUM(failed) AS failed
     FROM trends
     GROUP BY date
     ORDER BY date DESC
     LIMIT 7`,
  );
  const trends = trendsResult.rows as Array<{ date: string; total: string | number; passed: string | number; failed: string | number }>;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').fillColor('#111827').text('Quality Report', { align: 'center' });
    doc.moveDown(0.25);
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
      .text(`Run ${run.id.slice(0, 8)} · ${startDate}${run.branch ? ` · ${run.branch}` : ''}`, { align: 'center' });
    doc.moveDown(0.6);

    pdfKpis(doc, [
      { label: 'Pass Rate', value: `${passRate.toFixed(1)}%` },
      { label: 'Total', value: String(run.total) },
      { label: 'Failed', value: String(run.failed), color: run.failed > 0 ? '#dc2626' : '#111827' },
      { label: 'Flaky', value: String(run.flaky), color: run.flaky > 0 ? '#d97706' : '#111827' },
      { label: 'Skipped', value: String(run.skipped) },
    ]);

    // Trend section
    if (trends.length > 0) {
      pdfSectionHeader(doc, 'Pass-Rate Trend (Last 7 Days)');
      pdfTable(doc,
        [
          { header: 'DATE', width: 100, x: 50 },
          { header: 'TOTAL', width: 70, x: 155 },
          { header: 'PASSED', width: 70, x: 230 },
          { header: 'FAILED', width: 70, x: 305 },
          { header: 'PASS %', width: 70, x: 380 },
        ],
        trends.map((t) => {
          const rate = t.total > 0 ? ((t.passed / t.total) * 100).toFixed(1) : '0.0';
          return [
            { text: t.date },
            { text: String(t.total) },
            { text: String(t.passed), color: '#16a34a' },
            { text: String(t.failed), color: t.failed > 0 ? '#dc2626' : '#111827' },
            { text: `${rate}%` },
          ];
        }),
      );
    }

    // Flaky tests
    pdfSectionHeader(doc, `Top Flaky Tests (${flakyTests.length})`);
    if (flakyTests.length === 0) {
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('No retried tests in this run.');
    } else {
      pdfTable(doc,
        [
          { header: 'TEST', width: 200, x: 50 },
          { header: 'FILE', width: 180, x: 255 },
          { header: 'RETRIES', width: 55, x: 440 },
          { header: 'DURATION', width: 50, x: 495 },
        ],
        flakyTests.map((t) => [
          { text: truncate(t.title, 35) },
          { text: truncate(t.file, 30), color: '#6b7280' },
          { text: String(t.retry_count), color: '#d97706' },
          { text: t.duration_ms ? formatMs(t.duration_ms) : '-' },
        ]),
      );
    }

    // Slow tests
    pdfSectionHeader(doc, 'Top 10 Slowest Tests');
    if (slowTests.length === 0) {
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('No test duration data available.');
    } else {
      pdfTable(doc,
        [
          { header: 'TEST', width: 230, x: 50 },
          { header: 'FILE', width: 190, x: 285 },
          { header: 'DURATION', width: 65, x: 480 },
        ],
        slowTests.map((t) => [
          { text: truncate(t.title, 40) },
          { text: truncate(t.file, 33), color: '#6b7280' },
          { text: formatMs(t.duration_ms) },
        ]),
      );
    }

    // Failure categories
    if (failureCats.length > 0) {
      pdfSectionHeader(doc, 'Failure Categories');
      pdfTable(doc,
        [
          { header: 'CATEGORY', width: 250, x: 50 },
          { header: 'FINGERPRINTS', width: 80, x: 305 },
        ],
        failureCats.map((c) => [
          { text: truncate(c.name, 45) },
          { text: String(c.cnt) },
        ]),
      );
    }

    doc.moveDown(2);
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af').text(`Automate · ${new Date().toISOString()}`, { align: 'center' });
    doc.end();
  });
}

// ─── Executive Report ─────────────────────────────────────────────────────────

export async function generateExecutiveReport(runId: string): Promise<Buffer> {
  const runResult = await poolConnection.query(
    `SELECT id, status, started_at, finished_at, total, passed, failed, flaky, skipped,
            duration_ms, branch, commit_sha, gate_status, workspace_id
     FROM runs WHERE id = $1`,
    [runId],
  );
  const run = runResult.rows[0] as RunRow | undefined;
  if (!run) throw new Error(`Run ${runId} not found`);

  const passRate = run.total > 0 ? (run.passed / run.total) * 100 : 0;
  const startDate = new Date(run.started_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  // 30-day quality trend
  const trendRowsResult = await poolConnection.query(
    `SELECT date, SUM(total) AS total, SUM(passed) AS passed
     FROM trends
     GROUP BY date
     ORDER BY date DESC
     LIMIT 30`,
  );
  const trendRows = trendRowsResult.rows as Array<{ date: string; total: string | number; passed: string | number }>;

  // Rolling 30-day pass rate
  const totalTests30 = trendRows.reduce((s, r) => s + Number(r.total), 0);
  const passedTests30 = trendRows.reduce((s, r) => s + Number(r.passed), 0);
  const avgPassRate30 = totalTests30 > 0 ? (passedTests30 / totalTests30) * 100 : null;

  // Flaky test cost estimate: flaky tests × avg duration (time wasted on retries)
  const flakyCostRowResult = await poolConnection.query(
    `SELECT COUNT(*) AS flaky_count,
            AVG(duration_ms) AS avg_duration
     FROM tests
     WHERE run_id = $1 AND (status = 'flaky' OR retry_count > 0)`,
    [runId],
  );
  const flakyCostRow = flakyCostRowResult.rows[0] as { flaky_count: string | number; avg_duration: string | number | null };
  const flakyCostMs = Math.round(Number(flakyCostRow?.flaky_count ?? 0) * Number(flakyCostRow?.avg_duration ?? 0));

  // Quarantine effectiveness: compare pass rate before/after approving quarantined tests
  const quarantinedResult = await poolConnection.query(
    `SELECT COUNT(*) AS cnt FROM quarantine WHERE status = 'approved'`,
  );
  const quarantinedCount = Number((quarantinedResult.rows[0] as { cnt: string | number }).cnt);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').fillColor('#111827').text('Executive Summary', { align: 'center' });
    doc.moveDown(0.25);
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
      .text(`Run ${run.id.slice(0, 8)} · ${startDate}`, { align: 'center' });
    doc.moveDown(0.8);

    const gateColor = run.gate_status === 'passed' ? '#16a34a' : run.gate_status === 'failed' ? '#dc2626' : '#6b7280';
    pdfKpis(doc, [
      { label: 'Gate Status', value: (run.gate_status ?? 'N/A').toUpperCase(), color: gateColor },
      { label: 'Pass Rate', value: `${passRate.toFixed(1)}%` },
      { label: '30d Avg Pass', value: avgPassRate30 !== null ? `${avgPassRate30.toFixed(1)}%` : 'N/A' },
      { label: 'Total Tests', value: String(run.total) },
      { label: 'Flaky Tests', value: String(run.flaky) },
      { label: 'Quarantined', value: String(quarantinedCount) },
    ]);

    pdfSectionHeader(doc, 'Quality Trend (30 Days)');
    if (trendRows.length === 0) {
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('No trend data available yet.');
    } else {
      const recent = [...trendRows].reverse().slice(-7);
      pdfTable(doc,
        [
          { header: 'DATE', width: 100, x: 50 },
          { header: 'TOTAL', width: 70, x: 155 },
          { header: 'PASS %', width: 80, x: 230 },
        ],
        recent.map((t) => {
          const rate = t.total > 0 ? ((t.passed / t.total) * 100).toFixed(1) : '0.0';
          return [
            { text: t.date },
            { text: String(t.total) },
            { text: `${rate}%` },
          ];
        }),
      );
    }

    pdfSectionHeader(doc, 'Quality Investments');
    const bulletY = doc.y;
    const items = [
      `Flaky test time cost: ${flakyCostMs > 0 ? formatMs(flakyCostMs) : 'none'} (retries in this run × avg duration)`,
      `Quarantined tests: ${quarantinedCount} (isolated to unblock CI pipeline)`,
      `Pass rate trend (30d): ${avgPassRate30 !== null ? `${avgPassRate30.toFixed(1)}% avg` : 'insufficient data'}`,
    ];
    for (const item of items) {
      doc.fontSize(9).font('Helvetica').fillColor('#374151').text(`• ${item}`, { indent: 10 });
      doc.moveDown(0.3);
    }
    void bulletY; // used implicitly through doc.y

    doc.moveDown(2);
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af').text(`Automate · ${new Date().toISOString()}`, { align: 'center' });
    doc.end();
  });
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function generateStakeholderReport(runId: string, template: ReportTemplate): Promise<Buffer> {
  switch (template) {
    case 'release':   return await generateReleaseReport(runId);
    case 'quality':   return await generateQualityReport(runId);
    case 'executive': return await generateExecutiveReport(runId);
  }
}
