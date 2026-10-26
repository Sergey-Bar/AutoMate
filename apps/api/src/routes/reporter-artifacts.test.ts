import { describe, expect, it } from 'vitest';
import { createReporterRoutes } from './reporter.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { DEFAULT_WORKSPACE_ID } from '../repositories/run-repository.js';

/**
 * `POST /api/v1/reporter/runs/:runId/artifacts` — the live reporter's evidence door.
 *
 * A reporter that streams events has no runner credential and no execution job, so the
 * only door it had for a trace was none: a failed test arrived with a message and nothing
 * to open. This route takes the reporter secret, files the bytes against the run, and
 * answers with the descriptor the run's artifact list serves.
 */
const SECRET = ['reporter', 'artifacts', 'secret'].join('-');
const AUTH = { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };
const PATH = (runId: string) => `/api/v1/reporter/runs/${runId}/artifacts`;

function build(maxArtifactBytes?: number) {
  const store = new InMemoryExecutionStore();
  const app = withErrorBoundary(
    createReporterRoutes(SECRET, {
      repository: new InMemoryRunRepository(),
      artifacts: store,
      ...(maxArtifactBytes === undefined ? {} : { maxArtifactBytes }),
    }),
  );
  return { app, store };
}

const trace = Buffer.from('PK\u0003\u0004 a playwright trace').toString('base64');

describe('POST /api/v1/reporter/runs/:runId/artifacts', () => {
  it('files a trace against the run, readable from the run afterwards', async () => {
    const { app, store } = build();
    const { run } = await store.createRun({}, 'reporter-artifact-run');

    const response = await app.request(PATH(run.id), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        testId: 'checkout.spec.ts › pays [chromium]',
        name: '../../trace.zip',
        kind: 'trace',
        contentType: 'application/zip',
        bytesBase64: trace,
      }),
    });

    expect(response.status).toBe(201);
    const descriptor = (await response.json()) as Record<string, unknown>;
    expect(descriptor).toMatchObject({
      runId: run.id,
      jobId: null,
      testId: 'checkout.spec.ts › pays [chromium]',
      kind: 'trace',
      // The name is the reporter's, and the reporter is untrusted: no traversal survives.
      name: 'trace.zip',
      sizeBytes: Buffer.from(trace, 'base64').byteLength,
    });
    const stored = await store.getArtifact(String(descriptor['id']), DEFAULT_WORKSPACE_ID);
    expect(Buffer.from(stored?.bytes ?? []).toString()).toContain('a playwright trace');
  });

  it('refuses a caller without the reporter secret, and stores nothing', async () => {
    const { app, store } = build();
    const { run } = await store.createRun({}, 'reporter-artifact-unauthenticated');
    const response = await app.request(PATH(run.id), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a', kind: 'trace', contentType: 'x', bytesBase64: trace }),
    });
    expect(response.status).toBe(401);
    expect((await store.getRun(run.id))?.artifacts).toEqual([]);
  });

  it('answers NOT_FOUND for a run this store does not hold', async () => {
    const { app } = build();
    const response = await app.request(PATH('00000000-0000-4000-8000-000000000000'), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ name: 'a', kind: 'trace', contentType: 'x', bytesBase64: trace }),
    });
    expect(response.status).toBe(404);
  });

  it("cannot file evidence against another workspace's run", async () => {
    // The reporter secret is the install's, and the door resolves the run in the
    // reporter's own workspace: a run id from another workspace is a run that is not there.
    const { app, store } = build();
    const { run } = await store.createRun({}, 'reporter-artifact-foreign', 'workspace-other');
    const response = await app.request(PATH(run.id), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ name: 'a', kind: 'trace', contentType: 'x', bytesBase64: trace }),
    });
    expect(response.status).toBe(404);
    expect((await store.getRun(run.id))?.artifacts).toEqual([]);
  });

  it('refuses a body that is not an artifact', async () => {
    const { app, store } = build();
    const { run } = await store.createRun({}, 'reporter-artifact-invalid');
    const response = await app.request(PATH(run.id), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ name: 'a', kind: 'trace' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: 'INVALID_ARTIFACT' },
    });
  });

  it('applies the decoded-size ceiling, not the encoded one', async () => {
    const { app, store } = build(8);
    const { run } = await store.createRun({}, 'reporter-artifact-large');
    const response = await app.request(PATH(run.id), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        name: 'big.png',
        kind: 'screenshot',
        contentType: 'image/png',
        bytesBase64: Buffer.from(new Uint8Array(9)).toString('base64'),
      }),
    });
    expect(response.status).toBe(413);
  });

  it('accepts an artifact larger than the event body limit', async () => {
    // A trace is routinely bigger than the 5 MiB an event or a report may be, and the
    // reporter's one body limit used to cover this path too.
    const { app, store } = build();
    const { run } = await store.createRun({}, 'reporter-artifact-six-mib');
    const response = await app.request(PATH(run.id), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        name: 'video.webm',
        kind: 'video',
        contentType: 'video/webm',
        bytesBase64: Buffer.from(new Uint8Array(6 * 1024 * 1024).fill(1)).toString('base64'),
      }),
    });
    expect(response.status).toBe(201);
  });

  it('says NOT_CONFIGURED when no artifact store is wired', async () => {
    const app = withErrorBoundary(createReporterRoutes(SECRET, {}));
    const response = await app.request(PATH('00000000-0000-4000-8000-000000000000'), {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ name: 'a', kind: 'trace', contentType: 'x', bytesBase64: trace }),
    });
    expect(response.status).toBe(503);
  });
});
