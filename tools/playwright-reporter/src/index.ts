import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  PwAttachment,
  PwFullConfig,
  PwFullResult,
  PwSuite,
  PwTestCase,
  PwTestResult,
} from './playwright-types.js';
import { resolveOrigin } from './target.js';
import { Transport } from './transport.js';

export type * from './playwright-types.js';

/**
 * `@automate/playwright-reporter` — a Playwright run, streamed into AutoMate as it happens.
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [['list'], ['@automate/playwright-reporter']],
 * ```
 *
 * with `AUTOMATE_URL` and `AUTOMATE_REPORTER_SECRET` in the environment. Each test lands on
 * the run page as it finishes, and a failed attempt's trace, screenshot and video land
 * beside it in the run's artifact list, so the failure can be opened
 * (`npx playwright show-trace trace.zip`) without digging through a CI job's artifacts.
 *
 * It speaks the reporter events door (`POST /api/v1/reporter/events`) in its legacy wire
 * shape, and the artifact door (`POST /api/v1/reporter/runs/:runId/artifacts`). The test's
 * identity is computed by the server from what is sent here — file, `describe` path, title
 * and project — with the file relative to the config's `rootDir`, which is what
 * Playwright's JSON reporter writes, so a test's history does not split between this
 * reporter and an uploaded report.
 *
 * **For the CI gate, use `automate test`.** It uploads the finished report against a
 * project and answers with the verdict, which a streaming reporter cannot: the gate is a
 * statement about the whole run, and the process exits before a reporter could ask for it.
 * Sending one run through both doors records it twice.
 */

export interface ReporterOptions {
  /** The AutoMate origin. Defaults to `AUTOMATE_URL`. The secret is read from the environment only. */
  url?: string;
  /** Upload the attachments of a failed attempt. Default `true`. */
  uploadArtifacts?: boolean;
  /** The largest attachment sent, in bytes. Default 64 MiB, the server's own ceiling. */
  maxArtifactBytes?: number;
  /** Test seams. */
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  log?: (line: string) => void;
  retryDelayMs?: number;
}

const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{7,40}$/iu;
// ESC [ … m: the colour codes Playwright writes into every assertion message.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/json': '.json',
  'application/zip': '.zip',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/html': '.html',
  'text/plain': '.txt',
  'video/webm': '.webm',
};

type ReportedStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'timedOut';

export default class AutomateReporter {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly log: (line: string) => void;
  private transport: Transport | undefined;
  private rootDir = '';
  private readonly runId = randomUUID();

  constructor(private readonly options: ReporterOptions = {}) {
    this.env = options.env ?? process.env;
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: PwFullConfig, suite: PwSuite): void {
    const target = resolveOrigin(this.options.url ?? this.env['AUTOMATE_URL']);
    if ('refused' in target) {
      this.log(`AutoMate reporter: ${target.refused}`);
      return;
    }
    const secret = this.env['AUTOMATE_REPORTER_SECRET']?.trim();
    this.transport = new Transport({
      origin: target.origin,
      secret: secret === undefined || secret === '' ? undefined : secret,
      fetch: this.options.fetch ?? globalThis.fetch,
      log: this.log,
      retryDelayMs: this.options.retryDelayMs ?? 500,
    });
    this.rootDir = config.rootDir;
    const branch =
      present(this.env['AUTOMATE_BRANCH']) ??
      present(this.env['GITHUB_HEAD_REF']) ??
      present(this.env['GITHUB_REF_NAME']);
    const commit = present(this.env['AUTOMATE_COMMIT']) ?? present(this.env['GITHUB_SHA']);
    this.event('run:start', true, {
      total: suite.allTests().length,
      ...(branch === undefined ? {} : { branch }),
      ...(commit === undefined || !COMMIT.test(commit) ? {} : { commitSha: commit }),
      triggeredBy: 'playwright-reporter',
    });
  }

  onTestBegin(test: PwTestCase, result: PwTestResult): void {
    // Once per test, not per attempt: the route upserts the row on begin, so a begin per
    // retry would reset a test the run had already counted.
    if (result.retry !== 0) return;
    const describePath = describesOf(test.parent);
    const project = test.parent.project()?.name ?? '';
    this.event('test:begin', false, {
      testId: test.id,
      title: test.title,
      file: path.relative(this.rootDir, test.location.file).split(path.sep).join('/'),
      ...(describePath.length === 0 ? {} : { describePath }),
      ...(project === '' ? {} : { project }),
    });
  }

  onTestEnd(test: PwTestCase, result: PwTestResult): void {
    if (this.options.uploadArtifacts !== false && attemptFailed(result)) {
      for (const attachment of result.attachments) this.artifact(test, result, attachment);
    }
    if (!isFinalAttempt(test, result)) return;
    const status = reportedStatus(test.outcome(), result.status);
    const message = result.errors[0]?.message?.replace(ANSI, '').trim() ?? '';
    this.event('test:end', false, {
      testId: test.id,
      status,
      durationMs: Math.round(result.duration),
      ...((status === 'failed' || status === 'timedOut') && message !== ''
        ? { error: { message } }
        : {}),
    });
  }

  async onEnd(result: PwFullResult): Promise<void> {
    if (this.transport === undefined) return;
    this.event('run:end', false, {
      status:
        result.status === 'interrupted'
          ? 'interrupted'
          : result.status === 'passed'
            ? 'passed'
            : 'failed',
      // Playwright reports the run's duration with a fraction; the column is whole ms.
      durationMs: Math.round(result.duration),
    });
    await this.transport.drain();
  }

  private event(type: string, essential: boolean, payload: Record<string, unknown>): void {
    this.transport?.enqueue({
      label: type,
      path: '/api/v1/reporter/events',
      essential,
      body: () => Promise.resolve({ type, runId: this.runId, payload }),
    });
  }

  private artifact(test: PwTestCase, result: PwTestResult, attachment: PwAttachment): void {
    if (attachment.path === undefined && attachment.body === undefined) return;
    const name = artifactName(attachment);
    const max = this.options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    this.transport?.enqueue({
      label: name,
      path: `/api/v1/reporter/runs/${this.runId}/artifacts`,
      essential: false,
      body: async () => {
        const size = attachment.body?.byteLength ?? (await stat(attachment.path ?? '')).size;
        if (size > max) {
          throw new Error(`${name} is ${String(size)} bytes, over the ${String(max)}-byte limit`);
        }
        const bytes = attachment.body ?? (await readFile(attachment.path ?? ''));
        return {
          testId: test.id,
          name,
          kind: artifactKind(attachment),
          contentType: attachment.contentType,
          bytesBase64: bytes.toString('base64'),
          metadata: { attempt: result.retry },
        };
      },
    });
  }
}

export { AutomateReporter };

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

/** The `describe` titles between the file and the test, outermost first. */
function describesOf(suite: PwSuite): string[] {
  const titles: string[] = [];
  for (let at: PwSuite | undefined = suite; at?.type === 'describe'; at = at.parent) {
    titles.unshift(at.title);
  }
  return titles;
}

function attemptFailed(result: PwTestResult): boolean {
  return result.status === 'failed' || result.status === 'timedOut';
}

/**
 * Whether Playwright will run this test again. It retries only an unexpected result, and
 * never an interrupted one, so anything else is the test's last word.
 */
function isFinalAttempt(test: PwTestCase, result: PwTestResult): boolean {
  return (
    test.outcome() !== 'unexpected' ||
    result.status === 'interrupted' ||
    result.retry >= test.retries
  );
}

/**
 * The status the route stores, read from the **outcome**: `test.fail()` that failed is a
 * pass, and one that passed is a failure. An interrupted test produced no result of its
 * own — the run was stopped around it — so it is skipped rather than counted as failing.
 */
function reportedStatus(
  outcome: ReturnType<PwTestCase['outcome']>,
  status: PwTestResult['status'],
): ReportedStatus {
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'skipped') return 'skipped';
  if (outcome === 'expected') return status === 'skipped' ? 'skipped' : 'passed';
  if (status === 'interrupted') return 'skipped';
  return status === 'timedOut' ? 'timedOut' : 'failed';
}

function artifactName(attachment: PwAttachment): string {
  if (attachment.path !== undefined) return path.basename(attachment.path);
  const extension = EXTENSIONS[attachment.contentType] ?? '';
  return attachment.name.endsWith(extension) ? attachment.name : `${attachment.name}${extension}`;
}

function artifactKind(attachment: PwAttachment): string {
  if (attachment.name === 'trace') return 'trace';
  if (attachment.contentType.startsWith('image/')) return 'screenshot';
  if (attachment.contentType.startsWith('video/')) return 'video';
  return 'attachment';
}
