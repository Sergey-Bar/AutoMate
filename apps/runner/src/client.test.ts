import { describe, expect, it, vi } from 'vitest';
import { RunnerApiClient } from './client.js';

const registration = {
  runnerId: 'runner-1',
  token: 'short-lived-token',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  manifest: {
    id: 'runner-1',
    name: 'runner',
    version: '1.0.0',
    os: 'linux',
    arch: 'x64',
    capabilities: ['playwright'],
    labels: [],
    slots: 1,
  },
};

const claim = {
  jobId: 'job-1',
  runId: 'run-1',
  attempt: 1,
  leaseId: 'lease-1',
  fencingToken: 7,
  timeoutMs: 30_000,
  spec: { configuration: { playwrightProject: 'smoke-pass' } },
  availableAt: new Date().toISOString(),
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('RunnerApiClient', () => {
  it('uses canonical authenticated runner routes and preserves typed payloads', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/register')) return Response.json(registration, { status: 201 });
      if (path.endsWith('/claim')) {
        const count = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/claim')).length;
        return count === 1 ? new Response(null, { status: 204 }) : Response.json(claim);
      }
      if (path.endsWith('/events')) {
        return Response.json({
          results: [{ eventId: 'event-1', sequence: 1, status: 'accepted' }],
        });
      }
      if (path.endsWith('/artifacts')) {
        return Response.json(
          {
            id: 'artifact-1',
            runId: 'run-1',
            jobId: 'job-1',
            testId: null,
            kind: 'stdout',
            name: 'stdout.log',
            contentType: 'application/x-ndjson',
            storageKey: 'jobs/job-1/stdout.log',
            sizeBytes: 3,
            checksum: 'a'.repeat(64),
            createdAt: new Date().toISOString(),
            expiresAt: null,
            legalHold: false,
            metadata: {},
          },
          { status: 201 },
        );
      }
      return Response.json({ accepted: true });
    });
    const client = new RunnerApiClient({
      baseUrl: 'http://api.test',
      runnerId: 'runner-1',
      token: 'token',
      registrationSecret: 'registration-secret',
      fetchImpl: fetcher as unknown as typeof fetch,
    });

    await expect(
      client.register({
        protocolVersion: '1',
        runnerId: 'runner-1',
        name: 'runner',
        version: '1.0.0',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: [],
        slots: 1,
      }),
    ).resolves.toEqual(registration);
    await expect(client.claim({ capabilities: ['playwright'] })).resolves.toBeNull();
    await expect(client.claim()).resolves.toEqual(claim);
    await expect(
      client.sendEventBatch('job-1', 'lease-1', 7, [
        {
          version: '1',
          runId: 'run-1',
          eventId: 'event-1',
          sequence: 1,
          type: 'run.phase_changed',
          occurredAt: new Date().toISOString(),
          payload: { previousPhase: 'assigned', phase: 'running', outcome: null },
        },
      ]),
    ).resolves.toEqual({ results: [{ eventId: 'event-1', sequence: 1, status: 'accepted' }] });
    await client.uploadArtifact('job-1', {
      leaseId: 'lease-1',
      fencingToken: 7,
      kind: 'stdout',
      name: 'stdout.log',
      testId: null,
      contentType: 'application/x-ndjson',
      bytes: new Uint8Array([1, 2, 3]),
      checksum: 'a'.repeat(64),
      metadata: {},
    });
    await client.complete('job-1', {
      jobId: 'job-1',
      runId: 'run-1',
      leaseId: 'lease-1',
      fencingToken: 7,
      attempt: 1,
      status: 'passed',
      phase: 'complete',
      outcome: 'passed',
      artifactIds: [],
      finishedAt: new Date().toISOString(),
    });

    const registerCall = fetcher.mock.calls[0];
    const registerHeaders = new Headers(registerCall?.[1]?.headers);
    expect(registerHeaders.get('x-runner-registration-secret')).toBe('registration-secret');
    const eventCall = fetcher.mock.calls.find(([url]) => String(url).endsWith('/events'));
    const eventHeaders = new Headers(eventCall?.[1]?.headers);
    expect(eventHeaders.get('authorization')).toBe('Bearer short-lived-token');
    expect(eventCall?.[1]?.body).toContain('"fencingToken":7');
  });

  it('surfaces status and safe error codes without response bodies', async () => {
    const client = new RunnerApiClient({
      baseUrl: 'http://api.test',
      runnerId: 'runner-1',
      token: 'expired-token',
      fetchImpl: vi.fn(async () =>
        Response.json(
          { code: 'RUNNER_TOKEN_EXPIRED', detail: 'do-not-return-this' },
          { status: 401 },
        ),
      ) as unknown as typeof fetch,
    });
    await expect(client.claim()).rejects.toMatchObject({
      status: 401,
      code: 'RUNNER_TOKEN_EXPIRED',
      message: 'Runner API request failed (401, RUNNER_TOKEN_EXPIRED)',
    });
  });
});
