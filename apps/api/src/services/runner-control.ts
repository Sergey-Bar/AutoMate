import { randomBytes, randomUUID } from 'node:crypto';
import { digestOf } from '../execution/digest.js';

export interface RunnerIdentity {
  id: string;
  credential: string;
  capabilities: string[];
  status: 'active' | 'draining' | 'revoked';
}

export interface RunnerEventRecord {
  jobId: string;
  leaseId: string;
  fencingToken: number;
  sequence: number;
  type: 'progress' | 'artifact' | 'terminal';
  payload: Record<string, unknown>;
  terminal?: boolean;
}

export class RunnerControlService {
  private readonly enrollment = new Map<string, string>();
  private readonly runners = new Map<string, RunnerIdentity>();
  private readonly leases = new Map<
    string,
    {
      runnerId: string;
      leaseId: string;
      fencingToken: number;
      nextSequence: number;
      terminal?: string;
    }
  >();
  private readonly events = new Map<string, RunnerEventRecord[]>();

  enroll(token: string, capabilities: string[]): RunnerIdentity {
    const runnerId = this.enrollment.get(token);
    if (!runnerId) throw new Error('Invalid enrollment token');
    this.enrollment.delete(token);
    const identity = {
      id: runnerId,
      credential: randomBytes(32).toString('base64url'),
      capabilities,
      status: 'active' as const,
    };
    this.runners.set(identity.credential, identity);
    return identity;
  }

  issueEnrollmentToken(): string {
    const token = randomBytes(32).toString('base64url');
    this.enrollment.set(token, randomUUID());
    return token;
  }

  authenticate(credential: string): RunnerIdentity {
    const runner = this.runners.get(credential);
    if (!runner || runner.status === 'revoked') throw new Error('Invalid runner credential');
    return runner;
  }

  /**
   * Grants a lease and records the id that was granted.
   *
   * The `leaseId` used to be accepted and dropped — the parameter was named
   * `_leaseId` and the lease record held no id at all. `acceptEvent` could then check
   * the runner and the fencing token, so it accepted any event naming a lease that
   * was never issued by this service. The token orders *attempts*; the id says which
   * *grant* within the current attempt, and a record that omits it cannot answer the
   * second question.
   */
  acquire(runner: RunnerIdentity, jobId: string, leaseId: string): { fencingToken: number } {
    const current = this.leases.get(jobId);
    const fencingToken = (current?.fencingToken ?? 0) + 1;
    this.leases.set(jobId, { runnerId: runner.id, leaseId, fencingToken, nextSequence: 1 });
    return { fencingToken };
  }

  acceptEvent(
    runner: RunnerIdentity,
    event: RunnerEventRecord,
  ): 'accepted' | 'duplicate' | 'conflict' {
    const lease = this.leases.get(event.jobId);
    if (
      !lease ||
      lease.runnerId !== runner.id ||
      lease.leaseId !== event.leaseId ||
      lease.fencingToken !== event.fencingToken
    ) {
      return 'conflict';
    }
    const list = this.events.get(event.jobId) ?? [];
    const previous = list.find((item) => item.sequence === event.sequence);
    if (previous) {
      // Over the canonical form, not `JSON.stringify`. A retry rebuilt after a timeout
      // with its payload keys in a different order is the same event, and answering
      // `conflict` to it costs a re-claim rather than a resend — and the caller
      // cannot tell the two apart, because from its side they are the same request.
      return digestOf(previous) === digestOf(event) ? 'duplicate' : 'conflict';
    }
    if (event.sequence !== lease.nextSequence) return 'conflict';
    if (lease.terminal) return 'conflict';
    list.push(event);
    this.events.set(event.jobId, list);
    lease.nextSequence += 1;
    if (event.terminal)
      lease.terminal = String(event.payload['status'] ?? event.payload['state'] ?? 'completed');
    return 'accepted';
  }

  eventsFor(jobId: string): RunnerEventRecord[] {
    return [...(this.events.get(jobId) ?? [])];
  }
}
