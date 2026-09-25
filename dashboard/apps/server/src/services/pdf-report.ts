import PDFDocument from 'pdfkit';
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

export async function generateRunPdf(runId: string): Promise<Buffer> {
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

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ─── Title ──────────────────────────────────────────────────────────
    doc.fontSize(22).font('Helvetica-Bold').text('Test Run Report', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#666666')
      .text(`Run ${run.id.slice(0, 8)} · ${startDate}${run.branch ? ` · Branch: ${run.branch}` : ''}${run.commit_sha ? ` · Commit: ${run.commit_sha.slice(0, 7)}` : ''}`, { align: 'center' });
    doc.moveDown(1);

    // ─── Summary KPIs ───────────────────────────────────────────────────
    doc.fillColor('#000000');
    const kpis = [
      { label: 'Total', value: String(run.total) },
      { label: 'Passed', value: String(run.passed) },
      { label: 'Failed', value: String(run.failed) },
      { label: 'Flaky', value: String(run.flaky) },
      { label: 'Skipped', value: String(run.skipped) },
      { label: 'Pass Rate', value: `${passRate}%` },
      { label: 'Duration', value: duration },
      { label: 'Gate', value: run.gate_status ?? 'N/A' },
    ];

    const kpiY = doc.y;
    const kpiWidth = 60;
    const kpiStartX = 50;
    for (let i = 0; i < kpis.length; i++) {
      const kpi = kpis[i];
      if (!kpi) continue;
      const x = kpiStartX + i * kpiWidth;
      doc.fontSize(8).font('Helvetica').fillColor('#999999').text(kpi.label, x, kpiY, { width: kpiWidth, align: 'center' });
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text(kpi.value, x, kpiY + 12, { width: kpiWidth, align: 'center' });
    }
    doc.y = kpiY + 40;
    doc.moveDown(1);

    // ─── Separator ──────────────────────────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.5);

    // ─── Tests Table ────────────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('Test Results');
    doc.moveDown(0.5);

    const colX = { status: 50, title: 110, file: 300, duration: 445, retries: 500 };
    const colW = { status: 55, title: 185, file: 140, duration: 50, retries: 45 };

    // Header row
    const headerY = doc.y;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#666666');
    doc.text('STATUS', colX.status, headerY, { width: colW.status });
    doc.text('TEST', colX.title, headerY, { width: colW.title });
    doc.text('FILE', colX.file, headerY, { width: colW.file });
    doc.text('DURATION', colX.duration, headerY, { width: colW.duration });
    doc.text('RETRIES', colX.retries, headerY, { width: colW.retries });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    // Test rows
    for (const t of tests) {
      if (doc.y > 750) {
        doc.addPage();
      }

      const rowY = doc.y;
      const statusColor = getStatusColor(t.status);

      doc.fontSize(8).font('Helvetica-Bold').fillColor(statusColor)
        .text(t.status.toUpperCase(), colX.status, rowY, { width: colW.status });

      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(truncate(t.title, 40), colX.title, rowY, { width: colW.title });

      doc.fontSize(7).font('Helvetica').fillColor('#888888')
        .text(truncate(t.file, 30), colX.file, rowY, { width: colW.file });

      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(t.duration_ms ? formatMs(t.duration_ms) : '-', colX.duration, rowY, { width: colW.duration });

      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(String(t.retry_count ?? 0), colX.retries, rowY, { width: colW.retries, align: 'center' });

      doc.y = rowY + 14;
    }

    // ─── Footer ─────────────────────────────────────────────────────────
    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#999999')
      .text(`Generated by Mission Control · ${new Date().toISOString()}`, { align: 'center' });

    doc.end();
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'passed': return '#22c55e';
    case 'failed': case 'timedOut': return '#ef4444';
    case 'flaky': return '#eab308';
    case 'skipped': return '#94a3b8';
    default: return '#6b7280';
  }
}

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
