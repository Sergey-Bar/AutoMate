/**
 * api-adapter.ts — the API agent domain (ledger X-3 / BK-1).
 *
 * - **`run`** — execute one Bruno collection against a target URL. It queues a job the runner
 *   reads from `configuration.apiCollection`, `configuration.apiEnvironment` and
 *   `configuration.targetUrl`, and which requires the `api` capability. The runner builds the
 *   one `bru run` invocation itself (`apps/runner/src/api-run.ts`): this adapter carries no
 *   command, so nothing a caller sends can choose what is executed. The runner validates the
 *   collection against `RUNNER_API_COLLECTION_ROOT` and the target against
 *   `RUNNER_ALLOWED_TARGET_URLS`, and reports the JUnit result through the same events
 *   a Playwright job does. The answer is the accepted run (HTTP 202); status is read through
 *   the runs API, and as with `POST /api/v1/runs` a run waits in `queued` until a runner
 *   carrying `api` claims it.
 * - **`scan`** — *not supported.* Bruno has no discovery or contract-scan mode we run, so a
 *   "scan" result would be invented. Stays `501`, with the reason in the body.
 * - **`generate`** — *not supported.* Writing a collection from an OpenAPI document needs the
 *   AI gateway and a destination for the generated files; neither is wired here.
 */
import { ApiRunInputSchema, type ApiRunInput } from '@automate/shared-contracts';
import type { ToolRegistry } from '@automate/tool-sdk';
import type { ExecutionStore } from '../execution/types.js';
import type { SubmittableRun } from '../execution/run-submission.js';
import { createExecutionBridgeAdapter, defineAcceptedRunOperation } from './execution-bridge.js';

/** Why the pairs that stay `501` do. Rendered into the refusal body as `reason`. */
export const API_UNSUPPORTED_REASONS: Readonly<Record<string, string>> = {
  scan: 'The runner only executes Bruno collections that already exist; it has no discovery or contract-scan mode, so there is nothing to scan with.',
  generate:
    'Collection generation needs the AI gateway and a destination for the generated files; neither is wired to the api domain.',
};

export interface ApiAgentDeps {
  registry: ToolRegistry;
  store: ExecutionStore;
  workspaceId: string;
  requireIdempotencyKey: boolean;
}

/** The run request a validated `api.run` input stands for. */
export function apiRunRequest(input: ApiRunInput): SubmittableRun {
  return {
    source: 'agent:api',
    framework: 'bruno',
    testType: 'api',
    requiredCapabilities: ['api'],
    configuration: {
      apiCollection: input.collection,
      ...(input.environment === undefined ? {} : { apiEnvironment: input.environment }),
      targetUrl: input.targetUrl,
    },
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

/** Register `api.run`. `api.scan` and `api.generate` are deliberately absent. */
export function registerApiAgent(deps: ApiAgentDeps): void {
  deps.registry.register(
    defineAcceptedRunOperation({ domain: 'api', action: 'run', input: ApiRunInputSchema }),
    createExecutionBridgeAdapter<ApiRunInput>({
      id: 'api.bruno-execution',
      store: deps.store,
      workspaceId: deps.workspaceId,
      requireIdempotencyKey: deps.requireIdempotencyKey,
      toRunRequest: apiRunRequest,
    }),
  );
}
