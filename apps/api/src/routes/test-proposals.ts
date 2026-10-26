import { Hono } from 'hono';
import { TestProposalBodySchema } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import {
  listTestProposals,
  proposeTest,
  type TestProposalOptions,
} from '../services/test-proposal-service.js';

/**
 * AI test proposals. Who may do what:
 *
 *  - viewer: list a project's stored proposals;
 *  - operator: ask for one — it spends the installation's model budget, the class chat and
 *    the eval runner are in (`ROUTE_ROLES` holds the same row).
 *
 * Neither route changes a repository: a proposal is a patch a person reads.
 */
export interface TestProposalRouteOptions extends TestProposalOptions {
  access: CallerResolver;
}

export function createTestProposalRoutes(options: TestProposalRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const operator = requireRole('operator', options.access);

  app.get('/api/v1/projects/:id/health/test-proposals', viewer, async (context) =>
    context.json({ proposals: await listTestProposals(options, context.req.param('id')) }),
  );

  app.post('/api/v1/projects/:id/health/test-proposals', operator, async (context) => {
    const parsed = TestProposalBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid request', {
        details: { issues: parsed.error.issues },
      });
    }
    const { actor } = await callerOf(context, options.access);
    const proposal = await proposeTest(options, context.req.param('id'), parsed.data, actor);
    await audit(options, {
      actor,
      action: 'test-proposal.create',
      resourceType: 'test_proposal',
      resourceId: proposal.id,
      // What was asked and what it cost; never the patch or the source snippet.
      details: {
        projectId: proposal.projectId,
        kind: proposal.kind,
        path: proposal.path,
        suggestedPath: proposal.suggestedPath,
        model: proposal.model,
        provider: proposal.provider,
        inputTokens: proposal.tokens.input,
        outputTokens: proposal.tokens.output,
      },
    });
    return context.json(proposal, 201);
  });

  return app;
}
