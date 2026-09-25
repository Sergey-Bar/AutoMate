import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';

function redactions(): string[] {
  return [
    ...(process.env['RUNNER_REDACT_VALUES']?.split(',') ?? []),
    ...Object.entries(process.env)
      .filter(([key]) => /token|secret|password|credential|api[_-]?key/iu.test(key))
      .map(([, value]) => value ?? ''),
  ].filter(Boolean);
}

function redact(value: string): string {
  let result = value;
  for (const secret of redactions()) result = result.replaceAll(secret, '[REDACTED]');
  return result;
}

function errorValue(error: TestError): { message: string; location?: string } {
  return {
    message: redact(error.message ?? 'Playwright test failed'),
    ...(error.location
      ? {
          location: `${redact(error.location.file)}:${error.location.line}:${error.location.column}`,
        }
      : {}),
  };
}

export default class NdjsonReporter implements Reporter {
  private sequence = 0;

  onTestBegin(test: TestCase, _result: TestResult): void {
    this.write('test.started', {
      testId: test.id,
      title: redact(test.title),
      file: test.location.file,
      line: test.location.line,
      column: test.location.column,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.write('test.completed', {
      testId: test.id,
      title: redact(test.title),
      file: test.location.file,
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
      errors: result.errors.map(errorValue),
      attachments: result.attachments.map((attachment) => ({
        name: redact(attachment.name),
        path: attachment.path,
        contentType: attachment.contentType,
      })),
    });
  }

  onEnd(result: FullResult): void {
    const status =
      result.status === 'timedout'
        ? 'timed_out'
        : result.status === 'interrupted'
          ? 'cancelled'
          : result.status;
    this.write('run.progress', { status, durationMs: result.duration });
  }

  printsToStdio(): boolean {
    return false;
  }

  private write(type: string, payload: Record<string, unknown>): void {
    const path = process.env['AUTOMATE_RUNNER_EVENTS_PATH'];
    if (!path) return;
    const event = {
      eventId: randomUUID(),
      sequence: ++this.sequence,
      type,
      occurredAt: new Date().toISOString(),
      payload,
    };
    appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}
