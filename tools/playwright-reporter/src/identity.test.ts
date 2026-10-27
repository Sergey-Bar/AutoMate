import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testIdentity } from '@automate/shared-contracts';
import { playwrightJsonAdapter, type ProducerContext } from '@automate/reporter';
import AutomateReporter from './index.js';
import type { PwSuite, PwTestCase } from './playwright-types.js';

/**
 * One test, through both doors, is one test.
 *
 * The server computes a streamed test's identity from the `test:begin` payload
 * (`reporter-persistence.ts`: `testIdentity({ file, describePath, title, project })`), and
 * an uploaded report's from the JSON adapter. If the two disagree — a file absolute in one
 * and relative in the other, a describe path that includes the file suite — a test's history
 * splits in two the day a team moves from `automate test` to the live reporter, and the
 * flake evidence of each half is half the evidence.
 */
const ROOT = path.resolve('/repo/e2e');

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'artifact://run-1/report',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-26T00:00:00.000Z',
  finishedAt: '2026-10-26T00:00:10.000Z',
};

function suite(type: PwSuite['type'], title: string, parent?: PwSuite, project?: string): PwSuite {
  return {
    type,
    title,
    ...(parent === undefined ? {} : { parent }),
    project: () => (project === undefined ? parent?.project() : { name: project }),
    allTests: () => [],
  };
}

describe('the streamed identity and the uploaded identity', () => {
  it('agree for a test in a nested describe, in a named project', async () => {
    const file = 'checkout/pay.spec.ts';
    const root = suite('root', '');
    const project = suite('project', 'webkit', root, 'webkit');
    const fileSuite = suite('file', file, project);
    const guest = suite('describe', 'guest', fileSuite);
    const card = suite('describe', 'by card', guest);
    const test: PwTestCase = {
      id: 'abc',
      title: 'pays › twice [really]',
      retries: 0,
      location: { file: path.join(ROOT, file), line: 1, column: 1 },
      parent: card,
      outcome: () => 'expected',
    };
    const sent: Array<Record<string, unknown>> = [];
    const reporter = new AutomateReporter({
      env: { AUTOMATE_URL: 'http://localhost:3000' },
      log: () => undefined,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{}', { status: 202 });
      }) as typeof fetch,
    });
    reporter.onBegin({ rootDir: ROOT }, root);
    reporter.onTestBegin(test, {
      retry: 0,
      status: 'passed',
      duration: 1,
      errors: [],
      attachments: [],
    });
    await reporter.onEnd({ status: 'passed', duration: 1 });
    const begin = sent.find((event) => event['type'] === 'test:begin')?.['payload'] as {
      file: string;
      title: string;
      describePath?: string[];
      project?: string;
    };
    const streamed = testIdentity(begin);

    // The same test as Playwright's JSON reporter writes it: one root suite per file,
    // `describe` blocks as nested suites, and the project on the spec's test entry.
    const report = {
      suites: [
        {
          title: file,
          file,
          suites: [
            {
              title: 'guest',
              file,
              suites: [
                {
                  title: 'by card',
                  file,
                  specs: [
                    {
                      title: 'pays › twice [really]',
                      file,
                      tests: [
                        {
                          projectName: 'webkit',
                          status: 'expected',
                          results: [
                            { status: 'passed', duration: 1, startTime: context.startedAt },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const uploaded = playwrightJsonAdapter.parse(
      new TextEncoder().encode(JSON.stringify(report)),
      context,
    ).attempts[0]?.testId;

    expect(streamed).toBe(uploaded);
    expect(streamed).toBe(
      testIdentity({
        file,
        describePath: ['guest', 'by card'],
        title: 'pays › twice [really]',
        project: 'webkit',
      }),
    );
  });
});
