import { ARTIFACT_KINDS } from '@automate/db';
import { describe, expect, it } from 'vitest';
import { normalizeArtifactKind } from './artifact-kind.js';

/**
 * The mapping that both execution stores used to hold privately, pinned now that there
 * is one copy of it.
 *
 * The test is not about the mappings being right — they were right, and the two copies
 * were byte-identical, which is worth saying because a de-duplication that quietly
 * changed behaviour would be a worse row than the duplication. It is about the
 * relationship the function has with the column, because that is the part a reader
 * cannot check by reading: a value outside `artifacts_kind_check` is not a subtle
 * difference between two stores, it is a `23514` from PostgreSQL.
 */
describe('normalizeArtifactKind', () => {
  it('maps every spelling a reporter or a runner uses to its column value', () => {
    expect(normalizeArtifactKind('raw_report')).toBe('report');
    expect(normalizeArtifactKind('report')).toBe('report');
    expect(normalizeArtifactKind('playwright-json')).toBe('json');
    expect(normalizeArtifactKind('json')).toBe('json');
    expect(normalizeArtifactKind('html-report')).toBe('html');
    expect(normalizeArtifactKind('event-log')).toBe('log');
  });

  it('is case-insensitive, because the callers are not consistent about it', () => {
    expect(normalizeArtifactKind('RAW_REPORT')).toBe('report');
    expect(normalizeArtifactKind('JUnit')).toBe('junit');
  });

  it('never produces a value the column CHECK would refuse', () => {
    // The assertion that earns the module its place. `ARTIFACT_KINDS` is the schema's
    // own list, so this fails the moment a kind is added to the column and forgotten
    // here, rather than on the first upload that uses it.
    for (const kind of [
      '',
      'raw_report',
      'attachment',
      'event-log',
      'something-a-future-reporter-invents',
      'a'.repeat(200),
    ]) {
      expect(ARTIFACT_KINDS, `"${kind}" normalised to something outside the vocabulary`).toContain(
        normalizeArtifactKind(kind),
      );
    }
  });

  it('falls back to `other` rather than refusing the evidence', () => {
    // A reporter may ship evidence the platform has not been taught to label. Losing
    // the upload would lose the thing the product exists to keep.
    expect(normalizeArtifactKind('something-a-future-reporter-invents')).toBe('other');
  });

  it('is total: every kind the vocabulary allows survives unchanged', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(normalizeArtifactKind(kind)).toBe(kind);
    }
  });
});
