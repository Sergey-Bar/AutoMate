import { sql } from 'drizzle-orm';
import { db } from './client.js';

export const builtInFlowTemplates = [
  {
    id: 'regression-gate',
    name: 'Regression Gate',
    description: 'Run tests, create Jira tickets, post Slack summary',
    systemPrompt: 'Use playwright, jira, slack tools in order.',
    steps: JSON.stringify([
      { description: 'Run tests', toolHint: 'playwright.run_tests' },
      { description: 'Create issue for failures', toolHint: 'jira.create_issue' },
      { description: 'Post summary', toolHint: 'slack.post_summary' },
    ]),
    category: 'regression',
    isBuiltIn: true,
  },
  {
    id: 'qa-assistant',
    name: 'QA Assistant',
    description: 'Conversational QA assistant with access to test data via Dashboard MCP tools',
    systemPrompt: `You are a QA intelligence assistant with access to live test data from the Dashboard. You can answer questions about test runs, pass rates, flaky tests, failure clusters, risk scores, and quality gates.

Key concepts you understand:
- Runs: A complete test execution with total/passed/failed counts and a gate status
- Pass rate: percentage of tests passing (passed/total × 100)
- Flaky tests: tests that sometimes pass and sometimes fail non-deterministically
- Quarantine: flaky tests isolated to prevent blocking the CI pipeline
- Quality gate: a pass rate threshold that must be met for a run to "pass" CI
- Risk scores: tests ranked by failure_rate × recency × correlation × cluster_severity (0-100)
- Failure clusters: groups of tests failing together, suggesting a shared root cause

When answering questions:
1. Use the available MCP tools to fetch real data (listRuns, getRiskScores, getGateStatus, getAnalytics, getFailureClusters)
2. Synthesize results into clear, actionable answers
3. For "Is it safe to release?" — check the latest gate status and risk scores
4. For flaky tests — use analytics to find tests with high flakiness rate
5. Always cite the data source (run ID, date range) in your answer`,
    steps: JSON.stringify([
      { description: 'Analyze question and identify needed data', toolHint: 'mcp.listRuns' },
      { description: 'Fetch relevant metrics', toolHint: 'mcp.getAnalytics' },
      { description: 'Synthesize answer', toolHint: null },
    ]),
    category: 'qa-intelligence',
    isBuiltIn: true,
  },
];

export async function seedDb(): Promise<void> {
  const now = new Date().toISOString();

  await db.execute(
    sql`INSERT INTO model_config (id, provider, model, endpoint, temperature, max_tokens, system_prompt, updated_at)
        VALUES ('default', 'ollama', 'llama3.1', 'http://localhost:11434', 0.7, 4096, NULL, ${now})
        ON CONFLICT (id) DO NOTHING`,
  );

  for (const template of builtInFlowTemplates) {
    await db.execute(
      sql`INSERT INTO flow_templates (id, name, description, system_prompt, steps, category, is_built_in, created_at, updated_at)
          VALUES (${template.id}, ${template.name}, ${template.description}, ${template.systemPrompt}, ${template.steps}, ${template.category}, ${template.isBuiltIn}, ${now}, ${now})
          ON CONFLICT (id) DO NOTHING`,
    );
  }
}

export async function seed(): Promise<void> {
  await seedDb();
}
