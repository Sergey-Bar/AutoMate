/**
 * teams.ts — Microsoft Teams integration service
 *
 * Sends run summary via incoming webhook using Adaptive Cards.
 */

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

export async function sendTeamsRunSummary(webhookUrl: string, run: RunSummary): Promise<void> {
  const emoji =
    run.status === 'passed' ? '✅' :
    run.status === 'failed' ? '❌' : '⚠️';

  const durationStr = run.durationMs
    ? `${Math.round(run.durationMs / 1000)}s`
    : 'N/A';

  const passRate = run.total > 0
    ? `${((run.passed / run.total) * 100).toFixed(1)}%`
    : '—';

  const bodyItems: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      size: 'Large',
      weight: 'Bolder',
      text: `${emoji} Test Run ${run.status.toUpperCase()}`,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Run ID', value: run.runId.slice(0, 8) },
        { title: 'Branch', value: run.branch ?? 'N/A' },
        { title: 'Pass Rate', value: passRate },
        { title: 'Duration', value: durationStr },
      ],
    },
    {
      type: 'TextBlock',
      text: `✅ ${run.passed} passed  ❌ ${run.failed} failed  ⚠️ ${run.flaky} flaky  ⏭ ${run.skipped} skipped`,
      wrap: true,
    },
  ];

  const actions: Array<Record<string, unknown>> = [];
  if (run.dashboardUrl) {
    actions.push({
      type: 'Action.OpenUrl',
      title: 'View in Dashboard',
      url: run.dashboardUrl,
    });
  }

  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: bodyItems,
          ...(actions.length > 0 ? { actions } : {}),
        },
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    throw new Error(`Teams webhook failed: ${response.status} ${response.statusText}`);
  }
}
