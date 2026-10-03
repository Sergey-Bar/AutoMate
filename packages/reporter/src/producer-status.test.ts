/**
 * producer-status.test.ts — the ladder, asserted from both sides.
 *
 * The point of `producer-status.ts` is that there is exactly one place a producer's word
 * becomes a canonical status. That claim has two halves and a table cannot check either on
 * its own, so this file checks both:
 *
 *  1. **Every rung is right.** Especially `interrupted` → `cancelled`, which the upload
 *     door got wrong in the direction of inflating the failure rate, and `running`, which
 *     means two different things and so needs two tables.
 *  2. **There is no fourth mapping.** Any module under `src/` that compares a raw producer
 *     status string to a canonical one is a copy of this table, and a copy is the defect.
 *     The second test fails the day somebody writes `status === 'failed' ? 'failed' : …`
 *     again.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalRunStatusFrom,
  canonicalTestStatusFrom,
  flakinessFrom,
  INGESTED_PRODUCERS,
  TEST_STATUS_MAPPING as PRODUCER_TEST_VOCABULARY,
  UNKNOWN_RAW_STATUS,
} from './producer-status.js';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));

describe('a producer test status becomes a canonical one', () => {
  it('holds exactly the vocabulary each producer emits, and no more', () => {
    // "Playwright emits `interrupted` and not `flaky`" is a claim about Playwright, and it
    // is checked here rather than living only as a comment on the table. A `flaky` row added
    // to the Playwright table would be a claim the tool does not make: Playwright expresses
    // a retry as several entries in `results[]`, and the adapter *computes* flakiness from
    // that history.
    expect(Object.keys(PRODUCER_TEST_VOCABULARY.playwright).sort()).toEqual([
      'cancelled',
      'failed',
      'interrupted',
      'passed',
      'skipped',
      'timedOut',
      'timed_out',
    ]);
    // JUnit has no status attribute of its own — the outcome children are the evidence — but
    // several tools emit `status="flaky"`, and the canonical adapter already honoured it.
    expect(Object.keys(PRODUCER_TEST_VOCABULARY.junit).sort()).toEqual([
      'failed',
      'flaky',
      'passed',
      'skipped',
      'timedOut',
      'timed_out',
    ]);
    // Both timeout spellings are accepted on every door, because Playwright emits
    // `timedOut`, other reporters send `timed_out`, and rejecting one would fail a real
    // upload. They are collapsed to one canonical status on the way in.
    expect(Object.keys(PRODUCER_TEST_VOCABULARY.legacy).sort()).toEqual([
      'cancelled',
      'failed',
      'flaky',
      'interrupted',
      'passed',
      'queued',
      'running',
      'skipped',
      'timedOut',
      'timed_out',
    ]);
  });

  it('counts an interrupted test as cancelled, not as a product failure', () => {
    // The bug this table was written for. Playwright emits `interrupted` when the harness
    // stopped the run, and the upload door mapped it to `failed` — so the harness's own
    // interruptions were counted as product defects. `cancelled` is what `policy.ts`
    // already classifies as non-product.
    expect(canonicalTestStatusFrom('playwright', 'interrupted')).toBe('cancelled');
    expect(canonicalTestStatusFrom('legacy', 'interrupted')).toBe('cancelled');
  });

  it('counts a test that has not reported as unobserved, never as a pass', () => {
    // `running` and `queued` are the two spellings of "declared, no outcome". Neither may
    // become `passed`: that is the one substitution a release gate cannot catch.
    expect(canonicalTestStatusFrom('legacy', 'running')).toBe('unknown');
    expect(canonicalTestStatusFrom('legacy', 'queued')).toBe('unknown');
    expect(canonicalTestStatusFrom('playwright', 'timed_out')).toBe('timedOut');
  });

  it('resolves a status it has never heard of to unobserved rather than throwing', () => {
    // The boundary already accepted it — the upload contract admits a status a given
    // adapter will not produce — so refusing the whole upload for it would turn a widened
    // vocabulary into a rejected run.
    for (const producer of INGESTED_PRODUCERS) {
      expect(canonicalTestStatusFrom(producer, 'mystery')).toBe(UNKNOWN_RAW_STATUS);
    }
  });

  it('reads the same word the same way for every producer that emits it', () => {
    const shared = ['passed', 'failed', 'skipped', 'timedOut', 'timed_out'] as const;
    for (const word of shared) {
      const readings = INGESTED_PRODUCERS.map((producer) =>
        canonicalTestStatusFrom(producer, word),
      );
      expect(new Set(readings).size, `producers disagree about "${word}"`).toBe(1);
    }
  });
});

describe('a declared run status is a different question from a test status', () => {
  it('keeps a run that has not finished open, where a running test is unobserved', () => {
    // Two tables rather than one, and this is the pair that proves why: `running` on a
    // *run* means no verdict exists yet; `running` on a *test* means that test has not
    // reported. One table would have to pick, and whichever it picked is wrong for the
    // other.
    expect(canonicalRunStatusFrom('running')).toBe('running');
    expect(canonicalTestStatusFrom('legacy', 'running')).toBe('unknown');
    expect(canonicalRunStatusFrom('queued')).toBe('running');
  });

  it('reads an interrupted run as cancelled for the same reason as an interrupted test', () => {
    expect(canonicalRunStatusFrom('interrupted')).toBe('cancelled');
    expect(canonicalRunStatusFrom('cancelled')).toBe('cancelled');
  });

  it('falls back to unobserved for a word outside the upload vocabulary', () => {
    expect(canonicalRunStatusFrom('queued-forever')).toBe(UNKNOWN_RAW_STATUS);
  });
});

describe('a producer that says flaky has witnessed a retry', () => {
  it('reads only the word flaky as observed evidence', () => {
    expect(flakinessFrom('flaky')).toBe('observed');
    expect(flakinessFrom('passed')).toBe('unknown');
    expect(flakinessFrom('failed')).toBe('unknown');
  });
});

describe('there is no fourth copy of the ladder', () => {
  it('finds no module under src/ that branches on a producer status word', () => {
    // `producer-status.ts` is the only place allowed to turn a producer's word into a
    // canonical status, and `canonical-run-result.ts` is the only place allowed to turn a
    // list of canonical statuses into a run's status. Every other module is a place the
    // first mapping could be re-implemented, which is exactly how the upload door came to
    // disagree with the adapters about the same report.
    //
    // The check is a comparison whose subject is a producer's own word, on a line that also
    // contains a canonical status literal. That is the shape of a copy of the table, and
    // it is narrower than "a function with `map` in its name": a producer adapter legitimately
    // holds a *producer-specific* rule — JUnit reads an outcome `<child>` element, which is
    // evidence the generic table has no row for — and legitimately delegates the `status`
    // attribute to the ladder. Flagging that would be flagging the right code.
    const offenders: string[] = [];
    for (const file of walkSources(sourceRoot)) {
      const relative = path.relative(sourceRoot, file);
      if (relative === 'producer-status.ts') continue;
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
        const subject = /\b(rawStatus|declaredStatus|producerStatus|resultStatus)\b/u.test(line);
        const decides =
          /\b(return|=|:)\s*'(passed|failed|flaky|skipped|timedOut|unknown|cancelled|running)'\b/u.test(
            line,
          );
        if (subject && decides) {
          offenders.push(`${relative}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      'a producer status is being mapped outside producer-status.ts; that is a second ladder',
    ).toEqual([]);
  });
});

/** Every `.ts` file under a directory, excluding tests. */
function walkSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkSources(full));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) found.push(full);
  }
  return found;
}
