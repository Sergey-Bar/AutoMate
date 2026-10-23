import { randomUUID } from 'node:crypto';
import { access, copyFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { junitXmlAdapter } from '@automate/reporter';
import { ApiRunInputSchema } from '@automate/shared-contracts';
import {
  RunnerConfigurationError,
  type ExecutionArtifact,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from './execution.js';
import type { GenericCommand } from './generic-spawn.js';

const require = createRequire(import.meta.url);

/** A job's API-run fields, checked by the same schema the API checked them with. */
const ApiRunFields = ApiRunInputSchema.pick({
  collection: true,
  environment: true,
  targetUrl: true,
});

export interface ApiExecutionOptions {
  /**
   * Runs the command this adapter builds. A `GenericSpawnAdapter` whose `repoRoot` is
   * `collectionRoot`, so the working directory (the collection) cannot leave it, and which
   * brings the deadline, the process-group kill, the environment allowlist and log capture.
   */
  delegate: ExecutionProvider;
  /** Where collections live on this host (`RUNNER_API_COLLECTION_ROOT`). */
  collectionRoot: string;
  /** Origins a collection may be pointed at (`RUNNER_ALLOWED_TARGET_URLS`). */
  allowedTargetUrls: readonly string[];
  /** The Bruno CLI entry point; the installed `@usebruno/cli` unless a test says otherwise. */
  bruCliPath?: string;
}

/**
 * Runs one Bruno collection and reports its JUnit result as test events.
 *
 * ## The job names a collection; it never names a command
 *
 * The argv is built here and nowhere else: `node bru.js run -r --sandbox safe --env-var
 * baseUrl=<target> [--env <name>] --reporter-junit <file>`. The collection, the environment
 * and the target are each validated first (the collection and environment by the contract
 * schema the API used, the target against the runner's allowlist), so a job row cannot make
 * this adapter run anything but `bru run` over a directory inside `collectionRoot`.
 * `--sandbox safe` is passed rather than relied on as a default, so a change of Bruno's
 * default cannot relax the script sandbox unnoticed.
 *
 * ## The verdict comes from the exit status and the report, like every generic run
 *
 * `bru` exits 0 when every request, assertion and test passed and 1 when one did not; the
 * delegate maps that to `passed` / `failed`, and a clean exit with no report is
 * `infra_failed`. The report is then read by `@automate/reporter`'s JUnit adapter and turned
 * into the `test.started` / `test.completed` events a Playwright run emits, which is what the
 * rest of the pipeline already projects into tests. An unreadable report is `infra_failed`:
 * the run asserted something nobody can read.
 */
export class ApiExecutionAdapter implements ExecutionProvider {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly bruCliPath: string;

  constructor(private readonly options: ApiExecutionOptions) {
    this.allowedOrigins = new Set(options.allowedTargetUrls.map((value) => new URL(value).origin));
    this.bruCliPath = options.bruCliPath ?? require.resolve('@usebruno/cli/bin/bru.js');
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const request = await this.validate(context);
    const report = `bruno-junit-${context.jobId.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 80) || 'job'}.xml`;
    const command: GenericCommand = {
      argv: [
        process.execPath,
        this.bruCliPath,
        'run',
        '-r',
        '--sandbox',
        'safe',
        '--env-var',
        `baseUrl=${request.targetUrl}`,
        ...(request.environment === undefined ? [] : ['--env', request.environment]),
        '--reporter-junit',
        report,
      ],
      workingDirectory: request.collection,
      artifactGlobs: [report],
      env: {},
      evidence: 'artifact',
    };
    const result = await this.options.delegate.execute({ ...context, command });
    const artifact = result.artifacts.find((candidate) => candidate.name === report);
    if (artifact === undefined) return result;
    return this.report(result, await this.adopt(artifact, result.workspacePath), context);
  }

  async cleanup(workspacePath: string): Promise<void> {
    await this.options.delegate.cleanup?.(workspacePath);
  }

  private async validate(context: ExecutionContext): Promise<{
    collection: string;
    environment: string | undefined;
    targetUrl: string;
  }> {
    const parsed = ApiRunFields.safeParse({
      collection: context.apiCollection,
      environment: context.apiEnvironment,
      targetUrl: context.targetUrl,
    });
    if (!parsed.success) {
      throw new RunnerConfigurationError(
        `API run is not valid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
    }
    const { collection, environment, targetUrl } = parsed.data;
    if (!this.allowedOrigins.has(new URL(targetUrl).origin)) {
      throw new RunnerConfigurationError('API run target is not in RUNNER_ALLOWED_TARGET_URLS');
    }
    if (!(await this.isCollection(collection))) {
      throw new RunnerConfigurationError('API run collection was not found in the collection root');
    }
    return { collection, environment, targetUrl };
  }

  /** A Bruno collection is a directory with a `bruno.json` (or an OpenCollection manifest). */
  private async isCollection(collection: string): Promise<boolean> {
    for (const manifest of ['bruno.json', 'opencollection.yml']) {
      try {
        await access(join(this.options.collectionRoot, collection, manifest));
        return true;
      } catch {
        // Try the next manifest name.
      }
    }
    return false;
  }

  /**
   * Moves the report out of the collection into the run's own workspace, so a run leaves
   * nothing in the (shared, possibly read-only-by-intent) collection directory and two runs of
   * one collection cannot read each other's report.
   */
  private async adopt(
    artifact: ExecutionArtifact,
    workspacePath: string,
  ): Promise<ExecutionArtifact> {
    const moved = join(workspacePath, artifact.name);
    await copyFile(artifact.path, moved);
    await rm(artifact.path, { force: true });
    return { ...artifact, path: moved };
  }

  private async report(
    result: ExecutionResult,
    artifact: ExecutionArtifact,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const artifacts = result.artifacts.map((candidate) =>
      candidate.name === artifact.name ? artifact : candidate,
    );
    try {
      await emitTestEvents(await readFile(artifact.path), artifact, context);
    } catch (error) {
      return {
        ...result,
        artifacts,
        status: 'infra_failed',
        error: {
          code: 'RUNNER_INFRA_FAILED',
          message: `Bruno report could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
        },
      };
    }
    return { ...result, artifacts };
  }
}

/** JUnit bytes to `test.started` / `test.completed` events, via the one JUnit adapter. */
async function emitTestEvents(
  bytes: Uint8Array,
  artifact: ExecutionArtifact,
  context: ExecutionContext,
): Promise<void> {
  const now = new Date().toISOString();
  const canonical = junitXmlAdapter.parse(bytes, {
    workspaceId: 'runner',
    runId: context.jobId,
    sourceUri: `runner://job/${context.jobId}/${artifact.name}`,
    sourceDigest: artifact.digest,
    producerVersion: 'bruno',
    adapterVersion: '1',
    startedAt: now,
    finishedAt: now,
  });
  const redact = (value: string): string =>
    (context.redactions ?? []).reduce(
      (text, secret) => (secret ? text.replaceAll(secret, '[REDACTED]') : text),
      value,
    );
  // An id of the report's own file, suite and title, so two requests that share a name in
  // different files are two tests, and not a retry of one.
  const attemptsSeen = new Map<string, number>();
  let sequence = 0;
  const send = async (type: string, payload: Record<string, unknown>): Promise<void> => {
    sequence += 1;
    await context.onEvent?.({
      eventId: randomUUID(),
      sequence,
      type,
      occurredAt: new Date().toISOString(),
      payload,
    });
  };
  for (const attempt of canonical.attempts ?? []) {
    const testId = [attempt.specPath, attempt.suite ?? '', attempt.title].join('::');
    const number = (attemptsSeen.get(testId) ?? 0) + 1;
    attemptsSeen.set(testId, number);
    const identity = {
      testId,
      attempt: number,
      title: redact(attempt.title),
      suite: attempt.suite === undefined ? undefined : redact(attempt.suite),
      file: attempt.specPath,
    };
    await send('test.started', identity);
    await send('test.completed', {
      ...identity,
      status: attempt.status,
      durationMs: attempt.durationMs ?? 0,
      errors: attempt.error === undefined ? [] : [{ message: redact(attempt.error.message) }],
    });
  }
}
