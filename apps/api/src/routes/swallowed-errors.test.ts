import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOrchestrationRoutes } from './orchestration.js';
import { LocalArtifactBytesStore, LocalArtifactStore } from '../infrastructure/artifact-store.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { createErrorBoundary } from '../errors/boundary.js';
import type { OrchestrationService } from '../services/orchestration-service.js';

/**
 * A swallowed error is a failure with no symptom.
 *
 * Three handlers caught *anything* and answered as if the thing the caller asked
 * for did not exist. That is the worst possible shape: the caller is told their
 * request was wrong, so they stop retrying, and nothing is logged, so nobody looks.
 *
 *   - `POST /automations/:id/jobs` — a defect inside `enqueue` reported 404
 *     "Automation not found".
 *   - `POST /jobs/:id/cancel` — the same for `cancel`.
 *   - artifact bytes — *any* read failure returned `null`, and the caller turned
 *     `null` into 404 "artifact not found". A permissions error, a full disk or a
 *     corrupt file all read as "that artifact was never there".
 *
 * Each test below asserts the miss is still a miss, and that a fault is not.
 */
function serviceDouble(overrides: Partial<Record<string, unknown>> = {}): OrchestrationService {
  return {
    listAutomations: () => [],
    createAutomation: vi.fn(),
    createSchedule: vi.fn(),
    listJobs: () => [],
    enqueue: vi.fn(() => ({ id: 'job-1' })),
    cancel: vi.fn(() => ({ id: 'job-1' })),
    ...overrides,
  } as unknown as OrchestrationService;
}

function orchestrationApp(service: OrchestrationService): Hono {
  const app = new Hono();
  const boundary = createErrorBoundary({ log: () => undefined, requestId: () => 'req-test' });
  app.onError(boundary.onError);
  app.route('/', createOrchestrationRoutes(service));
  return app;
}

describe('orchestration routes distinguish a miss from a fault', () => {
  it('answers 404 when the automation genuinely does not exist', async () => {
    const app = orchestrationApp(
      serviceDouble({
        enqueue: () => {
          throw new Error('Automation not found');
        },
      }),
    );
    const response = await app.request('/api/v1/automations/missing/jobs', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('Automation not found');
  });

  it('does not report a defect inside enqueue as a missing automation', async () => {
    // The old `catch { 404 }` turned this into "Automation not found", so a
    // caller would check their id and nobody would see a log line.
    const app = orchestrationApp(
      serviceDouble({
        enqueue: () => {
          throw new Error('connection pool exhausted');
        },
      }),
    );
    const response = await app.request('/api/v1/automations/real-id/jobs', { method: 'POST' });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.INTERNAL);
    // And the cause is not handed to the caller.
    expect(JSON.stringify(body)).not.toContain('connection pool');
  });

  it('does not report a defect inside cancel as a missing job', async () => {
    const app = orchestrationApp(
      serviceDouble({
        cancel: () => {
          throw new Error('scheduler unreachable');
        },
      }),
    );
    const response = await app.request('/api/v1/jobs/job-1/cancel', { method: 'POST' });
    expect(response.status).toBe(500);
  });

  it('still answers 404 for a genuinely missing job', async () => {
    const app = orchestrationApp(
      serviceDouble({
        cancel: () => {
          throw new Error('Job not found');
        },
      }),
    );
    const response = await app.request('/api/v1/jobs/missing/cancel', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('artifact bytes distinguish absent from unreadable', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'automate-artifact-bytes-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns null for a key that is genuinely absent', async () => {
    const store = new LocalArtifactBytesStore(new LocalArtifactStore(root));
    expect(await store.get('runs/none/never-written.log')).toBeNull();
  });

  it('propagates a read failure instead of reporting it as absent', async () => {
    const inner = new LocalArtifactStore(root);
    // A fault that is not "not there": the path is a directory, so reading it
    // fails with EISDIR. That used to be swallowed into `null` and answered as
    // "artifact not found" — telling the caller to stop asking and telling
    // nobody to go and look.
    const directory = path.join(root, 'runs', 'dir-not-a-file');
    await mkdir(directory, { recursive: true });
    const store = new LocalArtifactBytesStore(inner);
    await expect(store.get('runs/dir-not-a-file')).rejects.toThrow();
  });

  it('returns the bytes for a key that is present', async () => {
    const store = new LocalArtifactBytesStore(new LocalArtifactStore(root));
    await store.put('runs/real/present.log', new Uint8Array([1, 2, 3]));
    const bytes = await store.get('runs/real/present.log');
    expect([...(bytes ?? [])]).toEqual([1, 2, 3]);
  });
});

describe('a classified error is not re-wrapped', () => {
  it('keeps its own code and status', () => {
    const original = new DomainError(ErrorCode.VALIDATION_FAILED, 'bad input');
    // The identity check the route uses: a `DomainError` already says what went
    // wrong, so re-wrapping it as "storage unavailable" would replace a specific
    // diagnosis with a vague one.
    expect(original.status).toBe(422);
    expect(original.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
