import { isEnabled } from '../services/feature-flags.js';

const BASE_IDENTITY = `You are Automate, an AI-native QA orchestration assistant. You help QA engineers automate testing workflows by chaining tools together. You operate entirely on-premise — no data leaves the network. Be concise, technical, and action-oriented. Till all tests pass.`;

const DASHBOARD_CAPABILITIES_PROMPT = `You have access to Playwright test execution via the Dashboard connector:
- dashboard__triggerTestRun: Trigger a Playwright test run. Provide specCode (the test code) and specFileName.
- dashboard__getRunStatus: Check the status of a test run by its runId.
- dashboard__getRunResults: Get detailed test results for a completed run by runId.
- dashboard__listRecentRuns: List recent test runs from the Dashboard.

When you trigger a test run, remember the returned Run ID so you can check its status on follow-up queries. If the user asks about a previously triggered run, proactively use dashboard__getRunStatus with the stored Run ID.

When a user asks "why did my tests fail?" or similar questions about test failures, check if there is a stored triage result for their last triggered run. If a test run failed, an automatic AI triage is performed in the background. You can share the analysis results with the user by using dashboard__getRunStatus with the stored Run ID to retrieve failure details.`;

export interface BuildSystemPromptOptions {
  /** Override for dashboard-connector feature flag (useful in tests). Defaults to isEnabled('dashboard-connector'). */
  dashboardEnabled?: boolean;
}

/**
 * Builds the system prompt for the LLM agent.
 * Combines the base Automate identity with an optional flow template prompt,
 * Dashboard capabilities (when the feature flag is on), and available tool names.
 */
export function buildSystemPrompt(
  flowPrompt?: string,
  availableTools?: string[],
  options?: BuildSystemPromptOptions,
): string {
  const parts = [BASE_IDENTITY];

  const dashboardEnabled =
    options?.dashboardEnabled !== undefined
      ? options.dashboardEnabled
      : isEnabled('dashboard-connector');

  if (dashboardEnabled) {
    parts.push(`\n\nDashboard Testing Capabilities:\n${DASHBOARD_CAPABILITIES_PROMPT}`);
  }

  if (flowPrompt) {
    parts.push(`\n\nFlow Instructions:\n${flowPrompt}`);
  }

  if (availableTools && availableTools.length > 0) {
    parts.push(`\n\nAvailable Tools:\n${availableTools.map((t) => `- ${t}`).join('\n')}`);
  }

  return parts.join('');
}
