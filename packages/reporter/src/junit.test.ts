import { describe, expect, it } from 'vitest';
import { junitXmlAdapter } from './adapters/junit-xml.js';

const context = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'artifact://run-1/results.xml',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
};

describe('JUnit adapter', () => {
  it('maps testcases and failure elements without treating classnames as paths', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase classname="suite.pkg" name="passes" time="0.1"/><testcase classname="suite.pkg" name="fails"><failure>boom</failure></testcase></testsuite>',
      ),
      context,
    );
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].specPath).toBe('unknown.spec.ts');
    expect(result.attempts[1].status).toBe('failed');
  });

  it('rejects reports without testcases', () => {
    expect(() =>
      junitXmlAdapter.parse(new TextEncoder().encode('<testsuite/>'), context),
    ).toThrow();
  });
});
