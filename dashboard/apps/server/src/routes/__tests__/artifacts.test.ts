import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';

let testApp: TestApp;

describe('artifacts routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { artifactsRoutes } = await import('../artifacts.js');
    await artifactsRoutes(testApp.app);
    await testApp.app.ready();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /artifacts/* returns 403 for path traversal attempts', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/artifacts/..%5Csecret.txt' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden' });
  });

  it('GET /artifacts/* returns 404 for non-existent files', async () => {
    const missingId = fixtures.workspace({ name: 'missing-artifact' }).id;
    const res = await testApp.app.inject({ method: 'GET', url: `/artifacts/${missingId}.zip` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Artifact not found' });
  });
});
