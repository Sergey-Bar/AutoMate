import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { runs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { readConfig, type IntegrationConfig } from '../services/integrations/config.js';
import { resolveBaseRun, compareRunToBase, generatePrCommentMarkdown } from '../services/pr-comparison.js';
import { postOrUpdatePrComment, createCheckRun } from '../services/integrations/github.js';

const PrReportBody = z.object({
  runId: z.string().min(1),
  baseRunId: z.string().min(1).optional(),
});

export async function prIntegrationRoutes(app: FastifyInstance) {
  app.post('/api/pr/report', async (req, reply) => {
    const body = PrReportBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error.flatten() });
    }

    const [run] = await db.select().from(runs).where(eq(runs.id, body.data.runId));
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (!run.prNumber) {
      return reply.status(400).send({ error: 'Run has no PR metadata' });
    }

    const resolvedBaseRunId = body.data.baseRunId
      ? body.data.baseRunId
      : await resolveBaseRun(run.baseBranch ?? 'main', run.workspaceId ?? undefined);

    if (!resolvedBaseRunId) {
      return reply.send({ comparison: null, message: 'No base run found for comparison' });
    }

    const config: IntegrationConfig = readConfig();
    const comparison = await compareRunToBase(body.data.runId, resolvedBaseRunId, {
      ignoreQuarantined: config.github?.ignoreFlakyInComments ?? false,
    });

    const markdown = generatePrCommentMarkdown(comparison, {
      prNumber: run.prNumber,
      runId: body.data.runId,
      dashboardUrl: `http://localhost:${process.env.PORT ?? 4000}`,
    });

    let commentPosted = false;
    let checkCreated = false;

    if (
      config.github?.enabled &&
      config.github?.prComments &&
      config.github.token &&
      config.github.owner &&
      config.github.repo
    ) {
      await postOrUpdatePrComment(
        {
          token: config.github.token,
          owner: config.github.owner,
          repo: config.github.repo,
        },
        run.prNumber,
        markdown,
      );
      commentPosted = true;
    }

    if (
      config.github?.enabled &&
      config.github?.checkRuns &&
      run.commitSha &&
      config.github.token &&
      config.github.owner &&
      config.github.repo
    ) {
      const gateConclusion =
        run.gateStatus === 'passed' ? 'success' : run.gateStatus === 'failed' ? 'failure' : 'neutral';

      await createCheckRun(
        {
          token: config.github.token,
          owner: config.github.owner,
          repo: config.github.repo,
        },
        run.commitSha,
        gateConclusion,
        markdown,
      );
      checkCreated = true;
    }

    return reply.send({ comparison, commentPosted, checkCreated });
  });
}
