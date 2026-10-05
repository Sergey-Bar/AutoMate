import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { OUTPUT_TAIL_LINES, outputTail, runClient } from './rehearsal-client.mjs';

/**
 * **The defect this covers.**
 *
 * `scripts/migration-rehearse.mjs` ran its clients with `stdio: 'inherit'`, so nothing was
 * captured and a failed phase recorded only `node exited 1`. The first real run of the
 * rehearsal against a restore carrying two unattributed credentials therefore produced the
 * diagnosis `0020_connector_credentials_tenant.sql` was written to give —
 * *"2 vault_entries row(s) … carry no workspace_id"* — printed it to the terminal, and then
 * discarded it. `report.json` was the artefact the run exists to leave behind, and it said
 * nothing an operator could act on.
 *
 * The assertion is on the thrown message rather than on a printed line, because the thrown
 * message is what `rehearsal-run.mjs` turns into `phase.detail`.
 */

/**
 * @param {{ status?: number | null, stdout?: string, stderr?: string, error?: Error }} outcome
 * @returns {{ spy: import('./rehearsal-client.mjs').SpawnLike, seen: Array<{ command: string, args: readonly string[], options: Record<string, unknown> }> }}
 */
function fakeSpawn(outcome) {
  /** @type {Array<{ command: string, args: readonly string[], options: Record<string, unknown> }>} */
  const seen = [];
  return {
    seen,
    spy: (command, args, options) => {
      seen.push({ command, args, options });
      return outcome;
    },
  };
}

describe('running a rehearsal client', () => {
  it('keeps what the client said in the error a failed phase is recorded from', () => {
    const { spy } = fakeSpawn({
      status: 1,
      stdout: '',
      stderr:
        'ERROR:  2 vault_entries row(s) and 0 connector_configs row(s) carry no workspace_id, ' +
        'and both connector_name columns are currently unique installation-wide.',
    });

    // Three assertions on one message, so it is captured once rather than thrown three times —
    // `assert.throws` returns nothing, and re-running the client per pattern would also hide a
    // regression where the message changes between calls.
    let message = '';
    try {
      runClient({ spawn: spy, command: 'node', args: ['migrate.js'], env: {} });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assert.match(message, /node exited 1/u);
    assert.match(
      message,
      /carry no workspace_id/u,
      "the migration's own diagnosis is the evidence the row is about",
    );
    assert.match(message, /2 vault_entries row\(s\)/u);
  });

  it('writes the same output to the terminal, so the report and the operator agree', () => {
    const { spy } = fakeSpawn({ status: 1, stdout: '', stderr: 'the reason it failed\n' });
    const written = mock.method(process.stderr, 'write', () => true);
    try {
      assert.throws(() => runClient({ spawn: spy, command: 'psql', args: [], env: {} }));
      assert.equal(written.mock.callCount() >= 1, true, 'nothing reached the terminal');
      const emitted = written.mock.calls.map((call) => String(call.arguments[0])).join('');
      assert.match(emitted, /the reason it failed/u);
    } finally {
      written.mock.restore();
    }
  });

  it('bounds what goes into a report, because a restore prints every statement it managed', () => {
    const noise = Array.from({ length: 500 }, (_, index) => `statement ${String(index)}`).join(
      '\n',
    );
    const tail = outputTail(noise);

    assert.equal(tail.split('\n').length, OUTPUT_TAIL_LINES);
    assert.match(tail, /statement 499/u, 'the end is what matters, not the beginning');
    assert.equal(tail.includes('statement 0\n'), false);
  });

  it('reports a spawn failure by name rather than as a non-zero exit', () => {
    const { spy } = fakeSpawn({ error: new Error('ENOENT'), status: null });

    assert.throws(() => runClient({ spawn: spy, command: 'pg_dump', args: [], env: {} }), {
      message: /pg_dump: ENOENT/u,
    });
  });

  it('says nothing extra when a failing client printed nothing', () => {
    const { spy } = fakeSpawn({ status: 2, stdout: '', stderr: '' });

    assert.throws(() => runClient({ spawn: spy, command: 'pg_restore', args: [], env: {} }), {
      message: 'pg_restore exited 2',
    });
  });

  it('returns quietly on success, because a passing phase needs no narrative', () => {
    const { spy, seen } = fakeSpawn({ status: 0, stdout: 'ok\n', stderr: '' });
    const written = mock.method(process.stderr, 'write', () => true);
    try {
      const output = runClient({ spawn: spy, command: 'pg_dump', args: ['--file', 'x'], env: {} });
      assert.equal(output, 'ok\n');
      assert.equal(seen[0]?.command, 'pg_dump');
    } finally {
      written.mock.restore();
    }
  });

  it('passes the environment the caller supplied, so DATABASE_URL can be repointed at the restore', () => {
    const { spy, seen } = fakeSpawn({ status: 0, stdout: '', stderr: '' });
    runClient({
      spawn: spy,
      command: 'node',
      args: ['migrate.js'],
      env: { DATABASE_URL: 'postgresql://restore' },
      spawnOptions: { env: { DATABASE_URL: 'postgresql://restore' } },
    });

    assert.equal(seen[0]?.options['env'] !== undefined, true);
  });
});
