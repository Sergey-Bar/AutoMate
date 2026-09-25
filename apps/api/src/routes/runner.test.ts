import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { RunnerControlService } from '../services/runner-control.js';
import { createRunnerRoutes } from './runner.js';

describe('runner control route', () => {
  it('enrolls once, syncs, and accepts ordered events', async () => {
    const service = new RunnerControlService();
    const app = new Hono().route('/', createRunnerRoutes(service));
    const enrollmentToken = service.issueEnrollmentToken();
    const enrolled = await app.request('/api/v1/runner/v1/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentToken, capabilities: ['playwright'] }),
    });
    expect(enrolled.status).toBe(201);
    const identity = (await enrolled.json()) as { credential: string };
    const sync = await app.request('/api/v1/runner/v1/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.credential}` },
    });
    expect(sync.status).toBe(200);
  });

  it('accepts an event and rejects a stale sequence', async () => {
    const service = new RunnerControlService();
    const app = new Hono().route('/', createRunnerRoutes(service));
    const identity = service.enroll(service.issueEnrollmentToken(), []);
    service.acquire(identity, 'job-1', 'lease-1');
    const event = {
      eventId: 'event-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      fencingToken: 1,
      sequence: 1,
      type: 'progress',
      payload: { message: 'ok' },
    };
    const accepted = await app.request('/api/v1/runner/v1/jobs/job-1/events/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([event]),
    });
    expect(accepted.status).toBe(200);
    const conflict = await app.request('/api/v1/runner/v1/jobs/job-1/events/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([{ ...event, sequence: 3 }]),
    });
    expect(conflict.status).toBe(409);
  });

  it('rejects invalid enrollment and terminal event batches', async () => {
    const service = new RunnerControlService();
    const app = new Hono().route('/', createRunnerRoutes(service));
    expect(
      (await app.request('/api/v1/runner/v1/enroll', { method: 'POST', body: '{}' })).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/v1/runner/v1/enroll', {
          method: 'POST',
          body: JSON.stringify({ enrollmentToken: 'bad' }),
        })
      ).status,
    ).toBe(401);
    const identity = service.enroll(service.issueEnrollmentToken(), []);
    service.acquire(identity, 'job-terminal', 'lease-terminal');
    const event = {
      eventId: 'terminal-1',
      jobId: 'job-terminal',
      leaseId: 'lease-terminal',
      fencingToken: 1,
      sequence: 1,
      type: 'terminal' as const,
      payload: { message: 'done' },
    };
    const response = await app.request('/api/v1/runner/v1/jobs/job-terminal/events/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([event]),
    });
    expect(response.status).toBe(200);
  });

  it('rejects invalid event batches and unauthorized sync', async () => {
    const service = new RunnerControlService();
    const app = new Hono().route('/', createRunnerRoutes(service));
    const identity = service.enroll(service.issueEnrollmentToken(), []);
    const invalid = await app.request('/api/v1/runner/v1/jobs/job/events/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.credential}` },
      body: '{}',
    });
    expect(invalid.status).toBe(400);
    expect((await app.request('/api/v1/runner/v1/sync', { method: 'POST' })).status).toBe(401);
  });
});
