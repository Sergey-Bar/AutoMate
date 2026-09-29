import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A batch of N events cost N unconditional `UPDATE runs` statements.
 *
 * `completeJob` walks the prepared batch and, for every item, issues
 * `UPDATE runs SET event_sequence = <sequence>`. Every item in that loop belongs
 * to the same job and therefore the same run, so the loop writes the same row N
 * times and only the last write survives — N round trips for one row
 * (ledger Q-49).
 *
 * The same applies to the second update: it is conditional on a requestable
 * phase, so a batch of twenty test events may fire it once, and a batch
 * containing several phase changes fires it several times on the same row.
 *
 * Asserted on the *source* rather than on a statement count because a unit test
 * for this would need a PGlite, a real job, a lease, and a prepared batch — and
 * the thing being pinned is that the write is not in the loop at all, which is
 * visible in the code and invisible in a mock's call log. The behavioural
 * guarantee that the last write wins is already covered by the store's own tests
 * for event application; what was missing was the shape of the write.
 */
const source = readFileSync(path.join(import.meta.dirname, 'drizzle-execution-store.ts'), 'utf8');

/**
 * The body of the per-event `for` loop, and nothing else.
 *
 * The first version sliced from the accumulators to the outbox append, which is
 * the whole method body — and therefore included the single post-loop write the
 * fix introduced, so it reported the fix as still broken. The region has to be the
 * loop itself, matched by brace depth: the assertion is "this write is not inside
 * the loop", and a slice that includes what comes after the loop cannot say that.
 */
function completeJobLoop(): string {
  const open = source.indexOf('for (const item of prepared) {');
  expect(open, 'the per-event loop is still where it was').toBeGreaterThan(-1);
  let depth = 0;
  for (
    let index = open + 'for (const item of prepared) {'.length - 1;
    index < source.length;
    index += 1
  ) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error('the per-event loop has no matching close brace');
}

describe('the run row is written once per batch, not once per event', () => {
  it('does not update the run sequence inside the loop', () => {
    // `set({ eventSequence: ... })` inside the loop is the N round trips. The fix
    // moves it after the loop, so it must not appear in the loop at all.
    expect(completeJobLoop()).not.toMatch(/update\(runs\)/);
  });

  it('collects the final sequence and state for one write after the loop', () => {
    // The replacement has to remember the *last* value per run, so the accumulator
    // is what makes the fix legible rather than a mystery `set`.
    expect(completeJobLoop()).toMatch(/eventSequenceByRun\.set/);
    expect(completeJobLoop()).toMatch(/derivedStateByRun\.set/);
  });

  it('writes the row once per run after the loop, with the last values', () => {
    // The positive half, so the two negative assertions above cannot both pass
    // against a file where the update was simply deleted.
    //
    // Sliced *up to* the outbox append rather than from it: the first version
    // started at that index, which is downstream of the write it was looking for.
    const marker = source.indexOf('await this.appendOutboxBatch(tx, outboxBatch);');
    expect(marker, 'the outbox append is still where it was').toBeGreaterThan(-1);
    const loopEnd = source.indexOf('for (const [runId, sequence] of eventSequenceByRun)');
    expect(loopEnd, 'the single write follows the loop').toBeGreaterThan(-1);
    expect(loopEnd).toBeLessThan(marker);
    expect(source.slice(loopEnd, marker)).toMatch(/phase: derived\.phase/);
  });
});
