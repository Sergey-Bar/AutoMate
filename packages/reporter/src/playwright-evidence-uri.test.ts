import { describe, expect, it } from 'vitest';
import { playwrightJsonAdapter } from './adapters/playwright-json.js';
import type { ProducerContext } from './adapter.js';

/**
 * The real `ProducerContext`.
 *
 * The first attempt at this file guessed a context — `startedAt`, `finishedAt`, a
 * few obvious ids — and every case failed with "expected string, received undefined"
 * on `provenance`. Not a fixture problem: a *context* problem, and the row recorded
 * a different diagnosis for the same symptom, which is why the fixture was blamed
 * twice before the context was read.
 *
 * Copied from `adapter-parity.test.ts` rather than reconstructed, so the two suites
 * cannot drift apart on what a producer context is.
 */
const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'artifact://run-1/report',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
  finishedAt: '2026-09-25T00:00:10.000Z',
};

/** A one-test report carrying a single attachment with the given name. */
function reportWith(name: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      suites: [
        {
          file: 'tests/checkout.spec.ts',
          title: 'checkout',
          suites: [
            {
              file: 'tests/checkout.spec.ts',
              title: 'adds to cart',
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'passed',
                      attachments: [
                        {
                          name,
                          contentType: 'image/png',
                          // `body` is required by the adapter: an attachment with no
                          // body is skipped, which is the reason the first attempt at
                          // this test read `undefined` and was removed rather than
                          // left red.
                          body: Buffer.from('png').toString('base64'),
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
    }),
  );
}

const evidenceFor = (name: string): Array<{ uri: string }> => {
  const result = playwrightJsonAdapter.parse(reportWith(name), context);
  return result.attempts.flatMap((attempt) => attempt.evidence);
};

describe('the Playwright attachment name is encoded into the evidence URI', () => {
  // The name is the only segment of the evidence URI an outside party chooses: it
  // arrives inside a report uploaded by a build, so a pull request controls it. The
  // URI is what a reader *follows*, so a name that changes the URI does not corrupt a
  // string — it points at a different artifact, or at nothing, and nothing reports
  // either.

  it('leaves an ordinary name unchanged, so existing evidence URIs stay readable', () => {
    // The positive case, and the one that matters most: an encoding that mangled
    // normal names would make *every* evidence URI unreadable, which is worse than
    // the defect being fixed.
    const evidence = evidenceFor('screenshot.png');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.uri.endsWith('/screenshot.png')).toBe(true);
    // And it round-trips: decoding the last segment returns the original name.
    const last = decodeURIComponent((evidence[0]?.uri ?? '').split('/').pop() ?? '');
    expect(last).toBe('screenshot.png');
  });

  it.each([
    ['report?x=1', 'a query separator'],
    ['report#frag', 'a fragment separator'],
    ['dir/file.png', 'a path separator'],
  ])('encodes %s so it cannot restructure the URI', (name) => {
    const uri = evidenceFor(name)[0]?.uri ?? '';

    // The URI carries no query and no fragment. This is the assertion for `?` and
    // `#`, and the round-trip below does not catch either: `decodeURIComponent` of an
    // unencoded `report?x=1` is `report?x=1`, which "round-trips" perfectly while the
    // reference it names ends at `report`. The first version of this test asserted
    // only the round trip and passed against the unencoded adapter.
    expect(uri).not.toContain('?');
    expect(uri).not.toContain('#');

    // Whatever the name contained, the URI still has exactly the segments the adapter
    // writes: scheme, run, test, attempt, attachment, name. A `/` in the name would
    // otherwise add one.
    const afterScheme = uri.slice('artifact://'.length);
    expect(afterScheme.split('/')).toHaveLength(5);

    // And the name survives, which is what makes the encoding safe rather than
    // merely different.
    expect(decodeURIComponent(uri.split('/').pop() ?? '')).toBe(name);
  });

  it('round-trips a name that combines all three separators', () => {
    const name = 'a/b?c#d.png';
    const uri = evidenceFor(name)[0]?.uri ?? '';
    expect(uri).not.toContain('?');
    expect(uri).not.toContain('#');
    expect(uri.slice('artifact://'.length).split('/')).toHaveLength(5);
    expect(decodeURIComponent(uri.split('/').pop() ?? '')).toBe(name);
  });
});
