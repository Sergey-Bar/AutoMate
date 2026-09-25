import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { createExecutionRoutes } from './execution.js';
import type { ExecutionStore, StoredArtifact } from '../execution/types.js';

/**
 * A byte store that cannot be read (unmounted volume, failed fetch, artifact
 * written without a byte store) still leaves the metadata row behind. That is
 * a storage failure, not a missing artifact.
 */
class UnreadableBytesStore extends InMemoryExecutionStore {
  override async getArtifact(): Promise<StoredArtifact | null> {
    return null;
  }
}

const REGISTRATION_SECRET = 'runner-registration-secret';

async function seedArtifact(store: InMemoryExecutionStore) {
  const app = new Hono().route(
    '/',
    createExecutionRoutes({ store, runnerRegistrationSecret: REGISTRATION_SECRET }),
  );
  const run = await app.request('/api/v1/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'artifact-key' },
    body: JSON.stringify({ projectId: 'p', requiredCapabilities: ['playwright'] }),
  });
  const runId = ((await run.json()) as { id: string }).id;
  const registered = await app.request('/api/v1/runners/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-registration-secret': REGISTRATION_SECRET,
    },
    body: JSON.stringify({ runnerId: 'runner-artifacts', capabilities: ['playwright'], slots: 1 }),
  });
  const token = ((await registered.json()) as { token: string }).token;
  const claim = await app.request('/api/v1/runners/runner-artifacts/jobs/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: '{}',
  });
  const jobId = ((await claim.json()) as { jobId: string }).jobId;
  const uploaded = await app.request(`/api/v1/jobs/${jobId}/artifacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'trace.zip',
      contentType: 'application/zip',
      contentBase64: Buffer.from('trace').toString('base64'),
    }),
  });
  expect(uploaded.status).toBe(201);
  const descriptor = (await uploaded.json()) as { id: string; storageKey?: string };
  return { app, runId, artifactId: descriptor.id };
}

describe('artifact download truthfulness', () => {
  it('serves bytes when the store can read them', async () => {
    const { app, artifactId } = await seedArtifact(new InMemoryExecutionStore());
    const download = await app.request(`/api/v1/artifacts/${artifactId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('trace');
  });

  it('reports metadata-present but unreadable bytes as unavailable, not missing', async () => {
    const { app, artifactId } = await seedArtifact(new UnreadableBytesStore());
    const download = await app.request(`/api/v1/artifacts/${artifactId}`);
    expect(download.status).toBe(503);
    const body = (await download.json()) as {
      error: { code: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('ARTIFACT_BYTES_UNAVAILABLE');
    expect(body.error.details['artifactId']).toBe(artifactId);
  });

  it('still reports a genuinely unknown artifact as not found', async () => {
    const { app } = await seedArtifact(new UnreadableBytesStore());
    const download = await app.request('/api/v1/artifacts/does-not-exist');
    expect(download.status).toBe(404);
    const body = (await download.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('applies the same distinction to the run-scoped download', async () => {
    const { app, runId, artifactId } = await seedArtifact(new UnreadableBytesStore());
    const download = await app.request(`/api/v1/runs/${runId}/artifacts/${artifactId}`);
    expect(download.status).toBe(503);
    const body = (await download.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ARTIFACT_BYTES_UNAVAILABLE');
  });

  it('keeps the run-scoped 404 for an artifact that belongs to another run', async () => {
    const { app, artifactId } = await seedArtifact(new UnreadableBytesStore());
    const download = await app.request(`/api/v1/runs/other-run/artifacts/${artifactId}`);
    expect(download.status).toBe(404);
    const body = (await download.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('falls back to 404 for stores without a descriptor lookup', async () => {
    const store = new InMemoryExecutionStore();
    const descriptorless = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'getArtifactDescriptor') return undefined;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as ExecutionStore;
    const app = new Hono().route(
      '/',
      createExecutionRoutes({
        store: descriptorless,
        runnerRegistrationSecret: REGISTRATION_SECRET,
      }),
    );
    const download = await app.request('/api/v1/artifacts/unknown-id');
    expect(download.status).toBe(404);
    const body = (await download.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ARTIFACT_NOT_FOUND');
  });
});
