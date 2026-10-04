/**
 * Running a PostgreSQL client from the rehearsal, and keeping what it said.
 *
 * **Why this is a module and not three lines inside the command.** `scripts/migration-rehearse.mjs`
 * ran its clients with `stdio: 'inherit'`, which is right for the dump — a `pg_dump` that fails
 * halfway has written a partial file, and a rehearsal that restored from it would be reporting on
 * a database nobody had. But `inherit` also means **nothing is captured**, so when the migrate
 * phase failed the report recorded `node exited 1` and discarded the migration's own message.
 *
 * That is the whole argument for the artefact. `RF-5` is a row about an operator needing to know
 * whether their sealed rows survive a migration, and the run that ran
 * `0020_connector_credentials_tenant.sql` against a restore carrying two unattributed credentials
 * produced exactly the diagnosis the migration was written to give — *"N vault_entries row(s) …
 * carry no workspace_id"* — and then threw it away. A report an operator reads the next morning
 * cannot contain only the exit code.
 *
 * So: every client runs with its output **both** on the operator's terminal and into the thrown
 * error, which is what the phase detail is built from. The spawn is injected, so this is testable
 * with no PostgreSQL client installed at all.
 */

/**
 * The shape of `spawnSync` this module needs.
 *
 * Declared rather than imported so a test can pass a function that records what it was asked to
 * run — which is the only way to assert *which* client was invoked without a PostgreSQL client
 * being installed on the machine running the test.
 *
 * @typedef {(
 *   command: string,
 *   args: readonly string[],
 *   options: Record<string, unknown>,
 * ) => { error?: Error, status?: number | null, stdout?: string, stderr?: string }} SpawnLike
 */

/**
 * The tail of a client's output that goes into a report.
 *
 * Bounded because a failing `pg_restore` prints every statement it managed, and a report whose
 * `detail` is 40 000 characters is a report nobody reads to the end.
 */
export const OUTPUT_TAIL_LINES = 40;

/**
 * The last `OUTPUT_TAIL_LINES` lines of `output`, trimmed.
 *
 * @param {string} output
 * @returns {string}
 */
export function outputTail(output) {
  const lines = output.replace(/\r\n/gu, '\n').split('\n');
  return lines
    .slice(Math.max(0, lines.length - OUTPUT_TAIL_LINES))
    .join('\n')
    .trim();
}

/**
 * Run one client, surfacing its output to the terminal and to the report at the same time.
 *
 * `stdio: ['inherit', 'pipe', 'pipe']` is what makes both possible: the child writes straight to
 * the operator's terminal for stdout and stderr, while the pipes are captured for the thrown error.
 * On Windows `inherit` for stdout bypasses the pipe, so both are piped and re-emitted here rather
 * than relying on the two mechanisms at once.
 *
 * @param {object} options
 * @param {SpawnLike} options.spawn the injected `spawnSync`
 * @param {string} options.command
 * @param {readonly string[]} options.args
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {Record<string, unknown>} [options.spawnOptions]
 * @returns {string} the captured output, which is unused on success
 */
export function runClient({ spawn, command, args, env, spawnOptions = {} }) {
  const result = spawn(command, args, {
    ...spawnOptions,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...(spawnOptions['env'] === undefined ? {} : { env }),
  });

  if (result.error) throw new Error(`${command}: ${result.error.message}`);

  const captured = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // Re-emitted rather than inherited, so the operator sees exactly what the report holds.
  if (captured.trim() !== '') process.stderr.write(captured);

  if (result.status !== 0) {
    const tail = outputTail(captured);
    throw new Error(
      `${command} exited ${String(result.status)}` + (tail === '' ? '' : `:\n${tail}`),
    );
  }
  return captured;
}
