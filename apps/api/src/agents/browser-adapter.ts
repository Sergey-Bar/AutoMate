/**
 * browser-adapter.ts — the browser agent domain (ledger X-3 / BK-1).
 *
 * What the three actions mean here, decided from what the runner can honestly do:
 *
 * - **`run`** — execute one Playwright project against a target URL. It queues exactly the job
 *   `POST /api/v1/runs` would for `framework: playwright`: `configuration.playwrightProject`
 *   and `configuration.targetUrl` are what `apps/runner` reads (`runner-service.ts`), the job
 *   requires the `playwright` capability, and the runner validates the project and the target
 *   against `RUNNER_PLAYWRIGHT_PROJECTS` / `RUNNER_ALLOWED_TARGET_URLS`. The answer is the
 *   accepted run (HTTP 202); status is read through the runs API.
 * - **`scan`** — *not supported.* The only thing the runner does with a Playwright job is run
 *   `playwright test`; it has no list / dry-run mode and no accessibility scan, so any "scan"
 *   result would be invented. Stays `501`, with the reason in the body.
 * - **`generate`** — *not supported.* Faithful generation needs the AI gateway and a place to
 *   put the generated spec; neither exists. Stays `501`, with the reason in the body.
 *
 * "Configured" means the control plane accepts the run. As with `POST /api/v1/runs`, a run
 * with no enrolled runner carrying `playwright` waits in `queued` until one claims it; this
 * adapter does not pretend otherwise by refusing, nor by blocking.
 */
import { BrowserRunInputSchema, type BrowserRunInput } from '@automate/shared-contracts';
import type { ToolRegistry } from '@automate/tool-sdk';
import type { ExecutionStore } from '../execution/types.js';
import type { SubmittableRun } from '../execution/run-submission.js';
import { createExecutionBridgeAdapter, defineAcceptedRunOperation } from './execution-bridge.js';

/** Why the pairs that stay `501` do. Rendered into the refusal body as `reason`. */
export const BROWSER_UNSUPPORTED_REASONS: Readonly<Record<string, string>> = {
  scan: 'The runner only executes Playwright projects; it has no test-listing, dry-run or accessibility-scan mode, so there is nothing to scan with.',
  generate:
    'Test generation needs the AI gateway and a destination for the generated spec; neither is wired to the browser domain.',
};

export interface BrowserAgentDeps {
  registry: ToolRegistry;
  store: ExecutionStore;
  workspaceId: string;
  requireIdempotencyKey: boolean;
}

/** The run request a validated `browser.run` input stands for. */
export function browserRunRequest(input: BrowserRunInput): SubmittableRun {
  return {
    source: 'agent:browser',
    framework: 'playwright',
    testType: 'browser',
    requiredCapabilities: ['playwright'],
    configuration: { playwrightProject: input.project, targetUrl: input.targetUrl },
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

/** Register `browser.run`. `browser.scan` and `browser.generate` are deliberately absent. */
export function registerBrowserAgent(deps: BrowserAgentDeps): void {
  deps.registry.register(
    defineAcceptedRunOperation({
      domain: 'browser',
      action: 'run',
      input: BrowserRunInputSchema,
    }),
    createExecutionBridgeAdapter<BrowserRunInput>({
      id: 'browser.playwright-execution',
      store: deps.store,
      workspaceId: deps.workspaceId,
      requireIdempotencyKey: deps.requireIdempotencyKey,
      toRunRequest: browserRunRequest,
    }),
  );
}
