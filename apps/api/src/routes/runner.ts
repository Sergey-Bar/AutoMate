import { Hono } from 'hono';
import { z } from 'zod/v4';
import { DomainError } from '../errors/domain-error.js';
import { RunnerControlService } from '../services/runner-control.js';
import { bearerToken } from '../http/bearer-token.js';

const EnrollmentSchema = z.object({
  enrollmentToken: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
});
const EventSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  leaseId: z.string().min(1),
  fencingToken: z.number().int().min(1),
  sequence: z.number().int().min(1),
  type: z.enum(['progress', 'artifact', 'terminal']),
  payload: z.record(z.string(), z.unknown()),
});

type RunnerIdentity = ReturnType<RunnerControlService['authenticate']>;

/**
 * The service signals "this credential is not acceptable" by throwing. Every
 * handler used to wrap its whole body in `try { … } catch { return 401 }`, so an
 * internal defect inside a handler was reported to the runner as an
 * authentication failure — the hardest kind of bug to notice across a network.
 * Only this call is guarded; anything else reaches the central error handler
 * and becomes a logged 500.
 *
 * **The refusal is now a `DomainError` rather than a private error class.** It used to
 * throw `UnauthorizedError` for the private `onError` to recognise, which is what a
 * second boundary needs and what one boundary does not: with the class removed, the
 * boundary no longer has to know this route exists, and a runner client can branch on
 * `UNAUTHENTICATED` instead of on the absence of a `code`.
 */
function requireIdentity(
  service: RunnerControlService,
  header: string | undefined,
): RunnerIdentity {
  try {
    return service.authenticate(bearer(header));
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid runner credential') {
      throw new DomainError('UNAUTHENTICATED', 'Unauthorized', { cause: error });
    }
    throw error;
  }
}

export function createRunnerRoutes(service: RunnerControlService) {
  const app = new Hono();
  // No private `onError` here any more.
  //
  // This file registered its own, so it answered its own: an `UnauthorizedError` as a
  // bare `{ error: 'Unauthorized' }` with no `code`, everything else as a bare
  // `{ error: 'Internal error' }` with no request id and nothing reported. That is a
  // second error boundary, which `AGENTS.md` forbids, and it is the reason a runner
  // client had to match on prose: nothing in the body was branchable. The handlers below
  // now throw `DomainError`, and `errors/boundary.ts` renders them — the same way every
  // other route in this API answers.
  app.post('/api/v1/runner/v1/enroll', async (context) => {
    const parsed = EnrollmentSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError('INVALID_ENROLLMENT_REQUEST', 'Invalid enrollment request', {
        details: { issues: parsed.error.issues },
      });
    }
    try {
      const identity = service.enroll(parsed.data.enrollmentToken, parsed.data.capabilities);
      return context.json({ runnerId: identity.id, credential: identity.credential }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid enrollment token') {
        throw new DomainError('INVALID_ENROLLMENT_TOKEN', 'Invalid enrollment token', {
          cause: error,
        });
      }
      throw error;
    }
  });
  app.post('/api/v1/runner/v1/sync', async (context) => {
    const identity = requireIdentity(service, context.req.header('Authorization'));
    return context.json({ runnerId: identity.id, status: identity.status, jobs: [] });
  });
  app.post('/api/v1/runner/v1/jobs/:jobId/events/batch', async (context) => {
    const identity = requireIdentity(service, context.req.header('Authorization'));
    const events = z.array(EventSchema).safeParse(await context.req.json().catch(() => null));
    if (!events.success) {
      throw new DomainError('INVALID_EVENT_BATCH', 'Invalid event batch', {
        details: { issues: events.error.issues },
      });
    }
    const results = events.data.map((event) =>
      service.acceptEvent(identity, { ...event, jobId: context.req.param('jobId') }),
    );
    // `conflict` is a 409 and not a 400: the batch was well-formed, the runner is
    // behind. A runner that treats this as a bad request discards events it should
    // resend under its current sequence.
    if (results.includes('conflict')) {
      throw new DomainError('STALE_OR_CONFLICTING_EVENT', 'Stale or conflicting event');
    }
    return context.json({ results });
  });
  return app;
}

function bearer(header: string | undefined): string {
  return bearerToken(header) ?? '';
}
