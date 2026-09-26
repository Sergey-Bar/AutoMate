import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalRehearsal, isLocalPathWithin } from './local-rehearsal-guard.mjs';

test('accepts explicit loopback mode', () => {
  assert.deepEqual(
    assertLocalRehearsal({
      REHEARSAL_MODE: 'local',
      DATABASE_URL: 'postgresql://localhost:5432/automate',
    }),
    { databaseHost: 'localhost', databaseName: 'automate' },
  );
});

test('rejects remote and publication targets', () => {
  assert.throws(
    () =>
      assertLocalRehearsal({
        REHEARSAL_MODE: 'local',
        DATABASE_URL: 'postgresql://db.prod:5432/automate',
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      assertLocalRehearsal({
        REHEARSAL_MODE: 'local',
        DATABASE_URL: 'postgresql://localhost/automate',
        PUBLISH: 'true',
      }),
    /forbidden/,
  );
});

test('rejects path traversal outside the fixture root', () => {
  assert.equal(isLocalPathWithin('/tmp/root', '../secret'), false);
  assert.equal(isLocalPathWithin('/tmp/root', 'nested/file'), true);
});
