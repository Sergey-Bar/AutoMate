/**
 * email.ts — Email integration service
 *
 * Sends run summary via SMTP using nodemailer.
 */
import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

interface RunSummary {
  runId: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs?: number;
  branch?: string;
  dashboardUrl?: string;
}

export async function sendRunReportEmail(
  smtp: SmtpConfig,
  recipients: string[],
  run: RunSummary,
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const statusEmoji = run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⚠️';
  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(1) : '0';
  const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : 'N/A';

  const statusColor =
    run.status === 'passed' ? '#22c55e' :
    run.status === 'failed' ? '#ef4444' : '#f59e0b';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="padding:20px 24px;background:${statusColor};color:#fff;">
      <h1 style="margin:0;font-size:18px;font-weight:600;">${statusEmoji} Test Run ${run.status.toUpperCase()}</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">Run ${run.runId.slice(0, 8)}${run.branch ? ` · ${run.branch}` : ''}</p>
    </div>
    <div style="padding:20px 24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Pass Rate</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${passRate}%</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Duration</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${duration}</td>
        </tr>
        <tr style="border-top:1px solid #f3f4f6;">
          <td style="padding:8px 0;color:#22c55e;">✓ Passed</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${run.passed}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#ef4444;">✗ Failed</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${run.failed}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#f59e0b;">⚡ Flaky</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${run.flaky}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">⏩ Skipped</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${run.skipped}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Total</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${run.total}</td>
        </tr>
      </table>
      ${run.dashboardUrl ? `
      <div style="margin-top:20px;text-align:center;">
        <a href="${run.dashboardUrl}" style="display:inline-block;padding:10px 24px;background:${statusColor};color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
          View in Dashboard →
        </a>
      </div>` : ''}
    </div>
    <div style="padding:12px 24px;background:#f8f9fa;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">
      Mission Control · Playwright QA Dashboard
    </div>
  </div>
</body>
</html>`.trim();

  try {
    await transport.sendMail({
      from: smtp.user,
      to: recipients.join(', '),
      subject: `${statusEmoji} Test Run ${run.status.toUpperCase()} — ${run.passed}/${run.total} passed`,
      html,
    });
  } finally {
    transport.close();
  }

}