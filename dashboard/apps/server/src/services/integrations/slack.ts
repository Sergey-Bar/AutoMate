/**
 * slack.ts — Slack integration service
 *
 * Sends run summary via incoming webhook using Block Kit.
 */

import { escapeSlackMrkdwn } from '../../utils/sanitize-text.js';

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

export async function sendSlackRunSummary(webhookUrl: string, run: RunSummary): Promise<void> {
  const emoji =
    run.status === 'passed' ? ':white_check_mark:' :
    run.status === 'failed' ? ':x:' : ':warning:';

  const durationStr = run.durationMs
    ? `${Math.round(run.durationMs / 1000)}s`
    : 'N/A';

  const passRate = run.total > 0
    ? `${((run.passed / run.total) * 100).toFixed(1)}%`
    : '—';

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Test Run ${run.status.toUpperCase()}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Run ID:*\n\`${run.runId.slice(0, 8)}\`` },
        { type: 'mrkdwn', text: `*Branch:*\n${run.branch ? escapeSlackMrkdwn(run.branch) : 'N/A'}` },
        { type: 'mrkdwn', text: `*Pass Rate:*\n${passRate}` },
        { type: 'mrkdwn', text: `*Duration:*\n${durationStr}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:white_check_mark: ${run.passed} passed  :x: ${run.failed} failed  :warning: ${run.flaky} flaky  :fast_forward: ${run.skipped} skipped`,
      },
    },
  ];

  if (run.dashboardUrl) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${run.dashboardUrl}|View in Dashboard →>`,
      },
    });
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
  }
}
