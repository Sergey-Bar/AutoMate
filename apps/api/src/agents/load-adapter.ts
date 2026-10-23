/**
 * load-adapter.ts — the load agent domain (ledger X-3 / BK-1).
 *
 * What the three actions mean here, decided from what the runner can honestly do:
 *
 * - **`run`** — execute one k6 script, bounded, against a target URL. It queues a job that
 *   requires the `k6` capability and carries `configuration.k6 = { script, vus,
 *   durationSeconds }` plus `configuration.targetUrl`; the runner (`apps/runner`
 *   `k6-execution.ts`) re-validates all of it against the same contract ceilings, the script
 *   root and `RUNNER_ALLOWED_TARGET_URLS`, builds the k6 argv itself, and turns the k6
 *   summary into the canonical result through `@automate/reporter`. The answer is the accepted
 *   run (HTTP 202); status is read through the runs API.
 * - **`scan`** — *not supported.* The runner has no inventory of scripts or targets to scan;
 *   any "scan" result would be invented. Stays `501`, with the reason in the body.
 * - **`generate`** — *not supported.* Generating a load script needs the AI gateway and a
 *   destination for the script; neither is wired to this domain. Stays `501`.
 *
 * The job timeout is **derived**, never caller-chosen: the requested duration plus
 * {@link LOAD_TIMEOUT_GRACE_MS} for k6's start-up, graceful stop and summary write. A caller
 * cannot ask for a deadline shorter than the run (it would always time out) or far longer
 * (a stuck process would hold a runner slot).
 */
import {
  LOAD_DEFAULT_DURATION_SECONDS,
  LOAD_DEFAULT_VUS,
  LoadRunInputSchema,
  type LoadRunInput,
} from '@automate/shared-contracts';
import type { ToolRegistry } from '@automate/tool-sdk';
import type { ExecutionStore } from '../execution/types.js';
import type { SubmittableRun } from '../execution/run-submission.js';
import { createExecutionBridgeAdapter, defineAcceptedRunOperation } from './execution-bridge.js';

/** Why the pairs that stay `501` do. Rendered into the refusal body as `reason`. */
export const LOAD_UNSUPPORTED_REASONS: Readonly<Record<string, string>> = {
  scan: 'The runner has no inventory of load scripts or targets to discover, so there is nothing to scan.',
  generate:
    'Generating a load script needs the AI gateway and a destination for the script; neither is wired to the load domain.',
};

/** Added to the requested duration for k6 start-up, graceful stop and the summary write. */
export const LOAD_TIMEOUT_GRACE_MS = 60_000;

export interface LoadAgentDeps {
  registry: ToolRegistry;
  store: ExecutionStore;
  workspaceId: string;
  requireIdempotencyKey: boolean;
}

/** The run request a validated `load.run` input stands for. */
export function loadRunRequest(input: LoadRunInput): SubmittableRun {
  const durationSeconds = input.durationSeconds ?? LOAD_DEFAULT_DURATION_SECONDS;
  return {
    source: 'agent:load',
    framework: 'k6',
    testType: 'performance',
    requiredCapabilities: ['k6'],
    configuration: {
      k6: {
        script: input.script,
        vus: input.vus ?? LOAD_DEFAULT_VUS,
        durationSeconds,
      },
      targetUrl: input.targetUrl,
    },
    timeoutMs: durationSeconds * 1000 + LOAD_TIMEOUT_GRACE_MS,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
  };
}

/** Register `load.run`. `load.scan` and `load.generate` are deliberately absent. */
export function registerLoadAgent(deps: LoadAgentDeps): void {
  deps.registry.register(
    defineAcceptedRunOperation({
      domain: 'load',
      action: 'run',
      input: LoadRunInputSchema,
    }),
    createExecutionBridgeAdapter<LoadRunInput>({
      id: 'load.k6-execution',
      store: deps.store,
      workspaceId: deps.workspaceId,
      requireIdempotencyKey: deps.requireIdempotencyKey,
      toRunRequest: loadRunRequest,
    }),
  );
}
