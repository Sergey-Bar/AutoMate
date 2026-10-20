import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A batch of N events cost N unconditional `UPDATE runs` statements.
 *
 * `appendEvents` walks the prepared batch and, for every item, issues
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
 * guarantee that the last write wins is covered by the store's own event-application
 * tests in `drizzle-execution-store.test.ts`, which is where a transformation that
 * got the ordering wrong would actually be caught.
 */
const source = readFileSync(path.join(import.meta.dirname, 'drizzle-execution-store.ts'), 'utf8');

/** The body of the per-event `for` loop, and nothing else. */
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
    // The replacement has to remember the *last* value, so the accumulator is what
    // makes the fix legible rather than a mystery write. `eventRunState(...) ?? derivedState`
    // is "last phase-bearing event wins": an event that asks for no phase leaves the
    // earlier one standing.
    expect(completeJobLoop()).toMatch(/lastSequence = input\.sequence/);
    expect(completeJobLoop()).toMatch(/derivedState = eventRunState\(input\) \?\? derivedState/);
  });

  it('writes the row once, after the loop and before the outbox append, with the last values', () => {
    // The positive half, so the two negative assertions above cannot both pass
    // against a file where the update was simply deleted.
    //
    // Sliced *up to* the outbox append rather than from it: the first version
    // started at that index, which is downstream of the write it was looking for.
    const marker = source.indexOf('await this.appendOutboxBatch(tx, outboxBatch);');
    expect(marker, 'the outbox append is still where it was').toBeGreaterThan(-1);
    const call = 'await this.applyBatchToRun(tx, job.runId, lastSequence, derivedState);';
    const callAt = source.indexOf(call);
    expect(callAt, 'the single write follows the loop').toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(marker);
    expect(source.indexOf(call, callAt + 1), 'and there is only one call').toBe(-1);
    expect(callAt, 'and it is outside the loop').toBeGreaterThan(
      source.indexOf(completeJobLoop()) + completeJobLoop().length,
    );
  });

  it('is one UPDATE of the run carrying the sequence and the derived state', () => {
    const open = source.indexOf('private async applyBatchToRun(');
    expect(open, 'the write has a home').toBeGreaterThan(-1);
    const body = source.slice(open, source.indexOf('\n  }\n', open));
    expect(body.match(/\.update\(runs\)/g)).toHaveLength(1);
    expect(body).toMatch(/eventSequence: sequence/);
    expect(body).toMatch(/phase: derived\.phase/);
  });
});
