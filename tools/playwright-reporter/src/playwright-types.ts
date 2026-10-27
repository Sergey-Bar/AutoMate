/**
 * The parts of Playwright's reporter API this reporter reads, written structurally.
 *
 * The package ships with no runtime dependency, and a type import from
 * `@playwright/test/reporter` would make the published declarations name a package the
 * installer may have at another version. `reporter.test.ts` assigns the reporter to
 * Playwright's own `Reporter` type, so a field that drifts from Playwright's shape is a
 * compile error there rather than a reporter Playwright calls with something else.
 */

export interface PwLocation {
  file: string;
  line: number;
  column: number;
}

export interface PwSuite {
  type: 'root' | 'project' | 'file' | 'describe';
  title: string;
  parent?: PwSuite;
  project(): { name: string } | undefined;
  allTests(): PwTestCase[];
}

export interface PwTestCase {
  id: string;
  title: string;
  retries: number;
  location: PwLocation;
  parent: PwSuite;
  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky';
}

export interface PwAttachment {
  name: string;
  contentType: string;
  path?: string;
  body?: Buffer;
}

export interface PwTestResult {
  retry: number;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  errors: Array<{ message?: string }>;
  attachments: PwAttachment[];
}

export interface PwFullConfig {
  rootDir: string;
}

export interface PwFullResult {
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
  duration: number;
}
