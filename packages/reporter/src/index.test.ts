/**
 * index.test.ts — the package's public surface, read the way a consumer reads it.
 *
 * Every other test in this package imports a module by path, which means the barrel in
 * `index.ts` could re-export a name that no longer exists and the whole suite would stay
 * green while every consumer broke at import time. The barrel is the only file here with no
 * test of its own, and it is the only file a caller sees first.
 *
 * Each assertion is a *use*, not a `typeof`: importing a name proves the export exists, and
 * calling it with one value proves the export is the function and not a type or a
 * re-declared constant that happens to share the name.
 */

import { describe, expect, it } from 'vitest';
import * as index from './index.js';
import {
  canonicalRunResult,
  canonicalRunStatusFrom,
  canonicalTestStatusFrom,
  flakinessFrom,
  junitXmlAdapter,
  legacyUploadAdapter,
  parseReporterUploadPayload,
  playwrightJsonAdapter,
  runStatusFrom,
  safeRelativePath,
  INGESTED_PRODUCERS,
  UNKNOWN_RAW_STATUS,
} from './index.js';

describe('the barrel exports the adapters', () => {
  it('exports every adapter with the media type it advertises', () => {
    // `playwrightJsonAdapter` advertises Playwright's own vendor type rather than plain
    // JSON. Both are JSON documents and the route matches on the declared `format` field
    // rather than on this string, but the three media types are pinned here because an
    // adapter that advertised the wrong one would be selected by a content-negotiating
    // caller for a document it cannot read.
    expect(junitXmlAdapter.mediaType).toBe('application/xml');
    expect(playwrightJsonAdapter.mediaType).toBe('application/vnd.playwright+json');
    expect(legacyUploadAdapter.mediaType).toBe('application/json');
  });

  it('exports the safe-path rule the API imports instead of its own copy', () => {
    expect(safeRelativePath('../../etc/passwd')).toBe('passwd');
  });
});

describe('the barrel exports the ladder and the run status it feeds', () => {
  it('exports the producer vocabulary as data', () => {
    expect(INGESTED_PRODUCERS).toContain('junit');
    expect(UNKNOWN_RAW_STATUS).toBe('unknown');
  });

  it('exports both status readers, which mean different things', () => {
    expect(canonicalTestStatusFrom('legacy', 'running')).toBe('unknown');
    expect(canonicalRunStatusFrom('running')).toBe('running');
    expect(canonicalRunStatusFrom('interrupted')).toBe('cancelled');
    expect(flakinessFrom('flaky')).toBe('observed');
  });

  it('exports the run-status derivation every adapter calls', () => {
    expect(runStatusFrom(['passed', 'passed'])).toBe('passed');
    expect(runStatusFrom(['passed', 'failed'])).toBe('failed');
  });
});

describe('the barrel exports the canonical result builder', () => {
  it('builds a result the contract accepts', () => {
    const result = canonicalRunResult(
      {
        outcomes: ['passed'],
        attempts: [
          {
            index: 1,
            testId: 't',
            specPath: 'a.spec.ts',
            title: 'a',
            status: 'passed',
            rawStatus: 'passed',
            startedAt: '2026-10-02T00:00:00.000Z',
            finishedAt: '2026-10-02T00:00:01.000Z',
            evidence: [],
            flakiness: 'unknown',
          },
        ],
        producer: 'legacy',
        verifier: 'index-test',
      },
      {
        workspaceId: 'workspace-1',
        runId: 'r',
        sourceUri: 'reporter/upload',
        sourceDigest: 'c'.repeat(64),
        producerVersion: '1.0.0',
        adapterVersion: '2',
        startedAt: '2026-10-02T00:00:00.000Z',
      },
    );
    expect(result.status).toBe('passed');
    expect(result.provenance.adapterVersion).toBe('2');
  });

  it('exports the upload payload reader the API uses to refuse a body by name', () => {
    expect(parseReporterUploadPayload(JSON.stringify({ runId: 'r' })).runId).toBe('r');
  });
});

describe('the barrel exports nothing that is not there', () => {
  it('does not still export the pre-Wave-0 single reader', () => {
    // There used to be one `canonicalStatusFrom` for every producer word, and it is now two
    // readers because a run's `running` and a test's `running` are different facts. The old
    // name is gone rather than aliased: an alias would let a caller keep using it and
    // reintroduce the conflation, which is the defect the split exists to remove.
    expect(Object.keys(index)).not.toContain('canonicalStatusFrom');
  });
});
