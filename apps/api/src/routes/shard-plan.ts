/**
 * `POST /api/v1/projects/:id/shards/plan` — which files each CI shard runs, balanced by how
 * long each file took in the project's recent runs.
 *
 * A POST because the caller sends the file list: every file in it is planned, including the
 * ones with no history (SHARD-1), and a GET would have to fit ten thousand paths in a query
 * string. Nothing is written. The planner is `planShards` in `@automate/reporting`; this
 * route reads the durations and draws the cut-off.
 *
 * Guarded as the test-report route is — the reporter secret, or an access token pinned to
 * the project — because the caller is the same CI job, holding the same credential, one
 * step earlier.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ShardPlanBodySchema, type ShardPlanResponse } from '@automate/shared-contracts';
import { planShards } from '@automate/reporting';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { domainErrorResponse } from '../errors/boundary.js';
import type { RunRepository } from '../repositories/run-repository.js';

/** Recent enough to follow a spec that got slower, enough runs for a median to mean something. */
export const SHARD_HISTORY_RUNS = 20;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface ShardPlanRouteOptions {
  uploader: MiddlewareHandler;
  /** Where the durations are read. Absent, the route answers NOT_CONFIGURED. */
  repository: Pick<RunRepository, 'fileDurations'> | undefined;
  projectExists: (projectId: string) => Promise<boolean>;
  now?: () => Date;
}

export function createShardPlanRoutes(options: ShardPlanRouteOptions): Hono {
  const app = new Hono();
  app.post(
    '/api/v1/projects/:id/shards/plan',
    options.uploader,
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError('PAYLOAD_TOO_LARGE', 'Request body too large'),
        ),
    }),
    async (context) => {
      const repository = options.repository;
      if (repository === undefined) {
        throw new DomainError(ErrorCode.NOT_CONFIGURED, 'Run history is not configured', {
          callerSafe: true,
        });
      }
      const body = ShardPlanBodySchema.safeParse(await context.req.json().catch(() => null));
      if (!body.success) {
        throw new DomainError(ErrorCode.INVALID_REQUEST, 'Invalid shard plan request', {
          details: { issues: body.error.issues },
        });
      }
      const projectId = context.req.param('id');
      if (!(await options.projectExists(projectId))) {
        throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
      }
      const asOf =
        body.data.asOf === undefined ? (options.now?.() ?? new Date()) : new Date(body.data.asOf);
      const history = await repository.fileDurations(projectId, {
        asOf,
        runs: SHARD_HISTORY_RUNS,
      });
      const plan = planShards({
        total: body.data.total,
        files: body.data.files,
        history: history.files,
      });
      const response: ShardPlanResponse = {
        total: body.data.total,
        asOf: asOf.toISOString(),
        runs: history.runs,
        known: plan.known,
        unknown: plan.unknown,
        shards: plan.shards,
      };
      return context.json(response);
    },
  );
  return app;
}
