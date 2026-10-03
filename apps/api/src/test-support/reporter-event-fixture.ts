/**
 * A run reported through the streaming door, as the reporter SDK emits it.
 *
 * One fixture, shared by the event tests, so a change to the legacy wire shape is made in
 * one place rather than in every test that needs a run to have happened.
 *
 * Three tests — one failing, one retried into a flake, one passing — because a stream that
 * only ever contains passes cannot tell a working canonicaliser from one that always says
 * `passed`.
 *
 * `test:begin` carries the same `testId` as its `test:end`, because the event door
 * *patches* the test row it created rather than upserting it: a `test:end` for a test that
 * never began has nothing to patch and silently writes nothing.
 */

/**
 * @param runId the run to report
 * @param options `terminalStatus` is what `run:end` declares — `failed` by default, and
 *   `running` for a producer that streams a partial report and says so
 */
export function runEvents(
  runId: string,
  options: { terminalStatus?: 'failed' | 'running' } = {},
): unknown[] {
  const terminalStatus = options.terminalStatus ?? 'failed';
  const begin = (testId: string, title: string, file: string): unknown => ({
    type: 'test:begin',
    runId,
    payload: { testId, title, file },
  });
  const end = (
    testId: string,
    title: string,
    file: string,
    status: string,
    durationMs: number,
  ): unknown => ({
    type: 'test:end',
    runId,
    payload: { testId, title, file, status, durationMs },
  });
  return [
    { type: 'run:start', runId, payload: { status: 'running' } },
    begin('test-a', 'a', 'a.spec.ts'),
    end('test-a', 'a', 'a.spec.ts', 'passed', 10),
    begin('test-b', 'b', 'b.spec.ts'),
    end('test-b', 'b', 'b.spec.ts', 'failed', 20),
    // The retry: the same test reported again, which is how the legacy SDK expresses it. A
    // run whose flaky test is not in its evidence is a run that can be green.
    begin('test-b', 'b', 'b.spec.ts'),
    end('test-b', 'b', 'b.spec.ts', 'flaky', 15),
    begin('test-c', 'c', 'a.spec.ts'),
    end('test-c', 'c', 'a.spec.ts', 'passed', 30),
    { type: 'run:end', runId, payload: { status: terminalStatus } },
  ];
}
