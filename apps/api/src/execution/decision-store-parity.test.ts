import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import type { DecisionRecord } from '@automate/db';
import { DrizzleDecisionStore } from './drizzle-decision-store.js';
import { InMemoryDecisionStore } from './in-memory-decision-store.js';
import { bucketTimeline, DecisionError } from './decision-store.js';
import { DEFAULT_WORKSPACE_ID } from '../repositories/run-repository.js';

/**
 * The decision store, held to one rule across both implementations.
 *
 * ## Why this suite exists and what it is for
 *
 * The decision store is the only part of this product whose rows are *verdicts*
 * rather than measurements, and it is the part a tester's daily work depends on.
 * The failure that matters is not a crash — it is a store that answers "what did
 * I decide about this flake" with the first answer forever, or accepts a deferral
 * with no date in one deployment and refuses it in another. Both are invisible
 * until somebody acts on them, which is why the rule is pinned against **both**
 * implementations rather than tested once.
 *
 * The pattern is the sibling `store-parity.test.ts` for the execution store: one
 * scenario list, two harnesses, and the assertions run twice.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

function readMigrations(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

const WORKSPACE = '11111111-1111-4111-8111-222222222222';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '33333333-3333-4333-8333-333333333333';

/**
 * Two milliseconds, between writes an ordering assertion depends on.
 *
 * **The clock is the only thing the stores do not share.** Both stamp
 * `createdAt` from `new Date()`, and the in-memory one keeps it as an ISO
 * string with millisecond precision — so two verdicts recorded inside the same
 * millisecond would tie, and a tie between two timestamps makes "oldest first"
 * a property of the storage engine rather than of the store. The pause is what
 * makes the assertion below a sequence instead of a coincidence. It is not a
 * `waitFor`: nothing is being waited *for*, the clock is being separated.
 */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

let client: PGlite;

beforeAll(async () => {
  // The same freshness guard the execution parity suite runs: a store tested
  // against a stale `dist` is a store tested against a schema that no longer
  // matches, which is the one failure a green run would hide.
  const buildOutput = path.resolve(drizzleDirectory, '..', 'dist', 'index.js');
  const buildTime = statSync(buildOutput).mtimeMs;
  const stack = [path.resolve(drizzleDirectory, '..', 'src')];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime)
        throw new Error('packages/db is not built; run pnpm --filter @automate/db build');
    }
  }

  client = new PGlite();
  await client.exec(readMigrations());
  const db = drizzle(client, { schema });
  await (
    db as unknown as {
      insert: (table: unknown) => { values: (values: unknown) => Promise<unknown> };
    }
  )
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      name: 'decision-parity',
      configPath: 'config',
      testResultsDir: 'var/results',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  await (
    db as unknown as {
      insert: (table: unknown) => { values: (values: unknown) => Promise<unknown> };
    }
  )
    .insert(schema.projects)
    .values({
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Parity service',
      slug: 'parity-service',
      repoPath: '/repos/parity-service',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
});

afterAll(async () => {
  await client.close();
});

/** The scenarios, each running against both stores. */
const SCENARIOS: Array<{
  name: string;
  run: (store: DrizzleDecisionStore | InMemoryDecisionStore) => Promise<void>;
}> = [
  {
    name: 'records a verdict and reads it back',
    run: async (store) => {
      const recorded = await store.record(
        PROJECT,
        {
          findingId: 'flaky-decision',
          cell: 'e2e:frontend',
          verdict: 'accepted',
          ownerId: 'reviewer-1',
        },
        WORKSPACE,
      );
      expect(recorded.verdict).toBe('accepted');
      expect(recorded.findingId).toBe('flaky-decision');
      expect(recorded.cell).toBe('e2e:frontend');
      expect(recorded.decidedAt).not.toBeNull();
      const found = await store.find(PROJECT, 'flaky-decision', 'e2e:frontend', WORKSPACE);
      expect(found?.id).toBe(recorded.id);
    },
  },
  {
    name: 'replaces the verdict for the same finding and cell rather than adding a row',
    run: async (store) => {
      const first = await store.record(
        PROJECT,
        { findingId: 'zero-caps-mean', cell: null, verdict: 'open' },
        WORKSPACE,
      );
      const second = await store.record(
        PROJECT,
        { findingId: 'zero-caps-mean', cell: null, verdict: 'fixed', ownerId: 'reviewer-2' },
        WORKSPACE,
      );
      // **The loop's central invariant.** A second write for the same key is an
      // update, so there is exactly one row and it carries the newest verdict.
      const rows = await store.listForProject(PROJECT, WORKSPACE);
      expect(rows.filter((row) => row.findingId === 'zero-caps-mean')).toHaveLength(1);
      expect(second.id).toBe(first.id);
      expect(second.verdict).toBe('fixed');
    },
  },
  {
    name: 'keeps a verdict on one cell from covering another',
    run: async (store) => {
      await store.record(
        PROJECT,
        { findingId: 'flaky-decision', cell: 'e2e:frontend', verdict: 'accepted' },
        WORKSPACE,
      );
      const other = await store.record(
        PROJECT,
        { findingId: 'flaky-decision', cell: 'e2e:backend', verdict: 'open' },
        WORKSPACE,
      );
      // The identity of a decision is (finding, cell), not the finding alone:
      // one row for both would make a verdict on one test silently cover another.
      expect(other.verdict).toBe('open');
      const rows = await store.listForProject(PROJECT, WORKSPACE);
      expect(rows.filter((row) => row.findingId === 'flaky-decision')).toHaveLength(2);
    },
  },
  {
    name: 'fails closed: a new record is open, and an open record has no decision time',
    run: async (store) => {
      const created = await store.record(
        PROJECT,
        { findingId: 'hollow-tests', cell: 'unit:backend' },
        WORKSPACE,
      );
      // `open`, not `accepted`: a record that starts accepted excludes something
      // from reporting with nobody deciding that. And `decidedAt: null`, because
      // "seen" and "decided" are different states and the queue must not lie
      // about which one it is in.
      expect(created.verdict).toBe('open');
      expect(created.decidedAt).toBeNull();
      expect(await store.listOpen(WORKSPACE)).not.toHaveLength(0);
    },
  },
  {
    name: 'refuses a deferral with no date, in both stores, from the same rule',
    run: async (store) => {
      await expect(
        store.record(
          PROJECT,
          { findingId: 'gap-queue', cell: 'e2e:frontend', verdict: 'deferred' },
          WORKSPACE,
        ),
      ).rejects.toThrow(DecisionError);
      await expect(
        store.record(
          PROJECT,
          { findingId: 'gap-queue', cell: 'e2e:frontend', verdict: 'deferred' },
          WORKSPACE,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_DEFERRAL' });
      // …and with a date it is accepted, so the refusal is about the date and not
      // about the verdict.
      const dated = await store.record(
        PROJECT,
        {
          findingId: 'gap-queue',
          cell: 'e2e:frontend',
          verdict: 'deferred',
          deferUntil: '2026-12-01T00:00:00.000Z',
        },
        WORKSPACE,
      );
      expect(dated.deferUntil).toBe('2026-12-01T00:00:00.000Z');
    },
  },
  {
    name: 'keeps a note the patch did not name',
    run: async (store) => {
      await store.record(
        PROJECT,
        {
          findingId: 'quarantine-pending',
          cell: null,
          note: 'waiting on the owner of the fixture',
        },
        WORKSPACE,
      );
      const patched = await store.record(
        PROJECT,
        { findingId: 'quarantine-pending', cell: null, verdict: 'accepted' },
        WORKSPACE,
      );
      // A patch that said only "accepted" must not wipe the sentence somebody
      // wrote three days ago. The profile merge rule, applied to a verdict.
      expect(patched.note).toBe('waiting on the owner of the fixture');
      expect(patched.verdict).toBe('accepted');
    },
  },
  {
    name: 'scopes every read to one workspace',
    run: async (store) => {
      const created = await store.record(
        PROJECT,
        { findingId: 'pass-rate', cell: null, verdict: 'accepted' },
        WORKSPACE,
      );
      const other = await store.listForOtherWorkspace(PROJECT, OTHER_WORKSPACE);
      // The honest answer to a cross-tenant read is none, and it is the same
      // answer in both stores — the in-memory one by filtering on the workspace
      // the row was written with, the SQL one by the tenancy predicate in the
      // query rather than by a check after the fact.
      expect(other).toEqual([]);
      expect(await store.find(PROJECT, 'pass-rate', null, OTHER_WORKSPACE)).toBeNull();
      const mine = await store.find(PROJECT, 'pass-rate', null, WORKSPACE);
      expect(mine?.id).toBe(created.id);
    },
  },
  {
    name: 'orders the project list open first and then by recency',
    run: async (store) => {
      await store.record(
        PROJECT,
        { findingId: 'hollow-tests', cell: 'unit:frontend', verdict: 'open' },
        WORKSPACE,
      );
      await store.record(
        PROJECT,
        { findingId: 'structural-findings', cell: null, verdict: 'fixed' },
        WORKSPACE,
      );
      const rows = await store.listForProject(PROJECT, WORKSPACE);
      const verdicts = rows.map((row) => row.verdict);
      // The daily screen's order, not an accident of insertion: open is the work
      // that is waiting, and everything else is history.
      expect(verdicts.indexOf('open')).toBeLessThan(verdicts.indexOf('fixed'));
    },
  },
  {
    name: 'refuses a verdict the vocabulary does not contain',
    run: async (store) => {
      // **The vocabulary is closed in the store, not in the schema.** A `defer`
      // or a `wontfix` typed into a form is a state nobody renders and the query
      // cannot filter — so both stores refuse it, from the one rule the Drizzle
      // column enum and this check enforce together.
      await expect(
        store.record(
          PROJECT,
          { findingId: 'flaky-decision', cell: 'e2e:frontend', verdict: 'wontfix' as never },
          WORKSPACE,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_VERDICT' });
    },
  },
  {
    name: 'lists only the open rows for one workspace',
    run: async (store) => {
      // A row this scenario created, and then closed, is the thing that has to be
      // absent from the inbox. **The Drizzle store is one PGlite instance shared
      // across the whole file**, so a scenario that asserts on the *whole* list
      // would be asserting on rows other scenarios wrote — which is why this one
      // closes what it opens and asserts on that, rather than on the set.
      const created = await store.record(
        PROJECT,
        { findingId: 'gap-queue', cell: 'e2e:inbox', verdict: 'open' },
        WORKSPACE,
      );
      const open = await store.listOpen(WORKSPACE);
      expect(open.some((row) => row.id === created.id)).toBe(true);
      // A closed row leaves the inbox, in the same list and without a second
      // query: `deferUntil` is a kind of closed, and the vocabulary treats it as
      // one.
      await store.record(
        PROJECT,
        {
          findingId: 'gap-queue',
          cell: 'e2e:inbox',
          verdict: 'deferred',
          deferUntil: '2026-12-01T00:00:00.000Z',
        },
        WORKSPACE,
      );
      const after = await store.listOpen(WORKSPACE);
      expect(after.some((row) => row.id === created.id)).toBe(false);
      // And the same list is scoped, so another workspace's inbox is empty
      // rather than this one's.
      expect(await store.listOpen(OTHER_WORKSPACE)).toEqual([]);
    },
  },
  {
    name: 'returns no rows for another workspace even when the project is the same',
    run: async (store) => {
      // The read that has nothing to return, and it is the one a screen gets
      // wrong first: the project id is the same, so a query without the tenancy
      // predicate would answer with this workspace's decisions about it. Both
      // stores scope on the workspace *and* the project, which is what makes this
      // an empty list rather than a leak.
      await store.record(
        PROJECT,
        { findingId: 'flaky-decision', cell: 'e2e:frontend', verdict: 'open' },
        WORKSPACE,
      );
      const other = await store.listForOtherWorkspace(PROJECT, OTHER_WORKSPACE);
      expect(other).toEqual([]);
    },
  },
  {
    name: 'removes a row, and only from its own workspace',
    run: async (store) => {
      const created = await store.record(
        PROJECT,
        { findingId: 'zero-caps-mean', cell: 'e2e:platform', verdict: 'open' },
        WORKSPACE,
      );
      expect(await store.remove(created.id, OTHER_WORKSPACE)).toBe(false);
      expect(await store.find(PROJECT, 'zero-caps-mean', 'e2e:platform', WORKSPACE)).not.toBeNull();
      expect(await store.remove(created.id, WORKSPACE)).toBe(true);
      expect(await store.find(PROJECT, 'zero-caps-mean', 'e2e:platform', WORKSPACE)).toBeNull();
    },
  },
  {
    // **The patch that names a verdict and nothing else.** The route sends `null`
    // for every field a JSON body omits, and `null` and `undefined` both mean
    // "not named" — so a re-record must keep the deferral date rather than clear
    // it. The SQL store used to pass `null` through `optionalDate`, which writes
    // an explicit NULL and deletes the date; the in-memory store has always kept
    // it. Same request, two different persisted states, which is the one thing
    // this file exists to prevent.
    name: 'keeps a deferral date when the patch names only a verdict',
    run: async (store) => {
      const deferred = await store.record(
        PROJECT,
        {
          findingId: 'patch-deferral',
          cell: null,
          verdict: 'deferred',
          deferUntil: '2026-10-20T00:00:00.000Z',
          note: 'retry once the flake is fixed',
          ownerId: 'reviewer-1',
        },
        WORKSPACE,
      );
      expect(deferred.deferUntil).toBe('2026-10-20T00:00:00.000Z');

      const patched = await store.record(
        PROJECT,
        { findingId: 'patch-deferral', cell: null, verdict: 'fixed' },
        WORKSPACE,
      );
      // The verdict moved; nothing else did — least of all the date and the note
      // the caller never mentioned.
      expect(patched.verdict).toBe('fixed');
      expect(patched.deferUntil).toBe('2026-10-20T00:00:00.000Z');
      expect(patched.note).toBe('retry once the flake is fixed');
      expect(patched.ownerId).toBe('reviewer-1');
      // And the row the next read sees is the row this one returned, in both
      // implementations.
      const reread = await store.find(PROJECT, 'patch-deferral', null, WORKSPACE);
      expect(reread?.deferUntil).toBe('2026-10-20T00:00:00.000Z');
      expect(reread?.note).toBe('retry once the flake is fixed');
    },
  },
  {
    // **The round trip back to `open`.** A body with no `verdict` asks for
    // `open` (the default), so a decided row re-recorded through the API is
    // re-opened — and an `open` row must have no decision time, or "what I
    // decided" starts listing verdicts nobody made. The in-memory store used to
    // stamp `now` on any verdict change, including this one.
    name: 'clears the decision time when a decided verdict is re-opened',
    run: async (store) => {
      const decided = await store.record(
        PROJECT,
        { findingId: 'reopen-finding', cell: null, verdict: 'accepted', ownerId: 'reviewer-1' },
        WORKSPACE,
      );
      expect(decided.decidedAt).not.toBeNull();

      const reopened = await store.record(
        PROJECT,
        { findingId: 'reopen-finding', cell: null },
        WORKSPACE,
      );
      expect(reopened.verdict).toBe('open');
      expect(reopened.decidedAt).toBeNull();
      // And the history read agrees: nothing decided, so nothing in the window.
      const rows = await store.listFiltered(PROJECT, WORKSPACE, {
        ownerId: 'reviewer-1',
        since: '2026-01-01T00:00:00.000Z',
      });
      expect(rows.map((row) => row.findingId)).not.toContain('reopen-finding');
    },
  },
  {
    name: 'refuses a re-record whose deferral date is not an instant',
    run: async (store) => {
      // The guard the boundary now applies, and the store's own deferral rule:
      // `deferred` with a date that is not an instant is "in the future", which
      // is not a removal condition.
      await expect(
        store.record(
          PROJECT,
          { findingId: 'bad-date', cell: null, verdict: 'deferred', deferUntil: 'next tuesday' },
          WORKSPACE,
        ),
      ).rejects.toThrow(DecisionError);
    },
  },
  {
    name: 'retries a verdict after the row was removed, rather than failing the write',
    run: async (store) => {
      // The read-then-write's real race: a row that existed at the read and is
      // gone at the write. The store re-reads and creates rather than throwing,
      // because the caller's write is not the thing that went wrong.
      await store.record(
        PROJECT,
        { findingId: 'pass-rate', cell: null, verdict: 'accepted' },
        WORKSPACE,
      );
      await store.remove(
        (await store.find(PROJECT, 'pass-rate', null, WORKSPACE))?.id ?? '',
        WORKSPACE,
      );
      const recreated = await store.record(
        PROJECT,
        { findingId: 'pass-rate', cell: null, verdict: 'open' },
        WORKSPACE,
      );
      expect(recreated.verdict).toBe('open');
      expect((await store.find(PROJECT, 'pass-rate', null, WORKSPACE))?.verdict).toBe('open');
    },
  },
  {
    // **The scenario that keeps the tenant key a name.** `decision_records` was
    // declared with a `uuid` `workspace_id` for one wave — every *id* in the
    // schema is one, and it looked right — and because `DEFAULT_WORKSPACE_ID` is
    // `'default-workspace'`, a name, every read and every write failed with
    // `22P02 invalid input syntax for type uuid` on the default install. The
    // loop this whole plan is about did not work at all until the column was
    // `text`. Writing under the production default is the cheapest way to stop
    // it coming back: this scenario fails against a uuid column in SQL, and the
    // in-memory half of it cannot mask the failure because it asserts the same
    // read path.
    name: 'records and reads under the workspace id the default install uses',
    run: async (store) => {
      const recorded = await store.record(
        PROJECT,
        { findingId: 'default-workspace-finding', cell: null, verdict: 'open' },
        DEFAULT_WORKSPACE_ID,
      );
      expect(recorded.verdict).toBe('open');
      const rows = await store.listForProject(PROJECT, DEFAULT_WORKSPACE_ID);
      expect(rows.filter((row) => row.findingId === 'default-workspace-finding')).toHaveLength(1);
    },
  },
  {
    // **F0.1 — the inbox predicate.** One scenario per predicate, and the
    // finding ids are unique to it because the Drizzle harness is one PGlite
    // instance for the whole file: a scenario that asserted on the whole list
    // would be asserting on rows eleven other scenarios wrote.
    name: 'answers the inbox predicate with one owner’s open rows, oldest first',
    run: async (store) => {
      const first = await store.record(
        PROJECT,
        { findingId: 'inbox-first', cell: null, verdict: 'open', ownerId: 'inbox-owner' },
        WORKSPACE,
      );
      await pause();
      const second = await store.record(
        PROJECT,
        { findingId: 'inbox-second', cell: null, verdict: 'open', ownerId: 'inbox-owner' },
        WORKSPACE,
      );
      await pause();
      // Two rows the predicate must not answer with: another owner's work, and
      // this owner's work that is already closed.
      await store.record(
        PROJECT,
        { findingId: 'inbox-theirs', cell: null, verdict: 'open', ownerId: 'inbox-someone-else' },
        WORKSPACE,
      );
      await pause();
      await store.record(
        PROJECT,
        { findingId: 'inbox-closed', cell: null, verdict: 'fixed', ownerId: 'inbox-owner' },
        WORKSPACE,
      );

      const waiting = await store.listFiltered(PROJECT, WORKSPACE, {
        verdict: 'open',
        ownerId: 'inbox-owner',
      });
      // **The sequence, not the set.** A queue ordered by recency would put the
      // row that has waited three days below the one that arrived this morning,
      // which is a screen answering a different question than the one asked.
      expect(waiting.map((row) => row.findingId)).toEqual(['inbox-first', 'inbox-second']);
      expect(waiting.map((row) => row.id)).toEqual([first.id, second.id]);
    },
  },
  {
    // **F0.1 — the history predicate.** Same shape as the inbox one, and the
    // boundary is taken between two writes so the filter has something to
    // exclude: a `since` that selected every row would pass on a store whose
    // predicate did nothing.
    name: 'answers what one owner decided since an instant, newest first',
    run: async (store) => {
      await store.record(
        PROJECT,
        { findingId: 'history-before', cell: null, verdict: 'fixed', ownerId: 'history-owner' },
        WORKSPACE,
      );
      await pause();
      await store.record(
        PROJECT,
        {
          findingId: 'history-also-before',
          cell: null,
          verdict: 'accepted',
          ownerId: 'history-owner',
        },
        WORKSPACE,
      );
      await pause();
      // The boundary sits between the second and third writes, so the first two
      // are history and the last two are inside the window. **The pause before
      // it is load-bearing, not tidiness:** `toISOString()` truncates to the
      // millisecond, so an instant taken in the same millisecond as a write
      // produces the *same string*, and `at >= since` then includes a verdict
      // decided before the boundary — which is the correct reading of an equal
      // instant and the reason the boundary must be a strictly later one.
      await pause();
      const since = new Date().toISOString();
      await pause();
      await store.record(
        PROJECT,
        {
          findingId: 'history-after-first',
          cell: null,
          verdict: 'fixed',
          ownerId: 'history-owner',
        },
        WORKSPACE,
      );
      await pause();
      await store.record(
        PROJECT,
        {
          findingId: 'history-after-second',
          cell: null,
          verdict: 'accepted',
          ownerId: 'history-owner',
        },
        WORKSPACE,
      );
      await pause();
      // Someone else's decision inside the same window is not what I decided.
      await store.record(
        PROJECT,
        { findingId: 'history-theirs', cell: null, verdict: 'fixed', ownerId: 'history-other' },
        WORKSPACE,
      );

      const decided = await store.listFiltered(PROJECT, WORKSPACE, {
        ownerId: 'history-owner',
        since,
      });
      // Newest first, and only the two inside the window: the question is "what
      // did I decide lately", and an answer that includes a verdict from before
      // the boundary is an answer about a different period.
      expect(decided.map((row) => row.findingId)).toEqual([
        'history-after-second',
        'history-after-first',
      ]);
      // An `open` row has no decision time, so a `since` never returns one —
      // otherwise "what I decided" would list the things nobody has decided.
      await store.record(
        PROJECT,
        { findingId: 'history-open', cell: null, verdict: 'open', ownerId: 'history-owner' },
        WORKSPACE,
      );
      const still = await store.listFiltered(PROJECT, WORKSPACE, {
        ownerId: 'history-owner',
        since,
      });
      expect(still.map((row) => row.findingId)).not.toContain('history-open');
    },
  },
  {
    // **F0.4 — the timeline.** Asserted on the invariants rather than on exact
    // counts, because the Drizzle harness is one shared instance: other
    // scenarios' rows are in this project's timeline too, and only the finding
    // ids unique to this scenario can be asserted exactly.
    name: 'returns the same timeline in both stores, and it is internal',
    run: async (store) => {
      const at = new Date().toISOString();
      await store.record(
        PROJECT,
        { findingId: 'timeline-open', cell: null, verdict: 'open', ownerId: 'timeline-owner' },
        WORKSPACE,
      );
      await store.record(
        PROJECT,
        { findingId: 'timeline-fixed', cell: null, verdict: 'fixed', ownerId: 'timeline-owner' },
        WORKSPACE,
      );

      const timeline = await store.timeline(PROJECT, WORKSPACE, {
        findingIds: ['timeline-open', 'timeline-fixed', 'timeline-nobody'],
        weeks: 3,
        at,
      });

      // The window: three weeks, oldest first, each anchored on a Monday, and
      // the last one is the week `at` falls in.
      expect(timeline.window.weeks).toBe(3);
      expect(timeline.weeks).toHaveLength(3);
      const starts = timeline.weeks.map((week) => new Date(`${week.week}T00:00:00.000Z`).getTime());
      for (const start of starts) {
        expect(new Date(start).getUTCDay()).toBe(1);
      }
      expect(starts[1] - starts[0]).toBe(7 * 24 * 60 * 60 * 1000);
      const last = starts[2] as number;
      expect(Date.parse(at)).toBeGreaterThanOrEqual(last);
      expect(Date.parse(at)).toBeLessThan(last + 7 * 24 * 60 * 60 * 1000);
      expect(timeline.window.from).toBe(new Date(starts[0] as number).toISOString());

      // Every week carries the whole vocabulary, zero included, and `total` is
      // their sum — a screen reads the five keys it knows without a fallback.
      for (const week of timeline.weeks) {
        expect(Object.keys(week.counts).sort()).toEqual([
          'accepted',
          'deferred',
          'excluded',
          'fixed',
          'open',
        ]);
        expect(week.total).toBe(Object.values(week.counts).reduce((sum, n) => sum + n, 0));
      }

      // The undecided set is exact, and it is the finding nobody recorded: an
      // `open` row *has* a verdict — the vocabulary's word for seen and not yet
      // called — so it is the inbox's question, not the timeline's.
      expect(timeline.undecided).toEqual({ count: 1, findingIds: ['timeline-nobody'] });

      // The owners are ranked by how much they decided, and the tie is the name
      // rather than the order the rows happened to be read in.
      const mine = timeline.owners.find((owner) => owner.ownerId === 'timeline-owner');
      expect(mine?.decided).toBeGreaterThanOrEqual(1);
      for (let index = 1; index < timeline.owners.length; index += 1) {
        const previous = timeline.owners[index - 1] as { decided: number };
        const current = timeline.owners[index] as { decided: number };
        expect(previous.decided).toBeGreaterThanOrEqual(current.decided);
      }
    },
  },
];

describe('the decision store, across both implementations', () => {
  const harnesses = [
    { name: 'in-memory', make: () => new InMemoryDecisionStore() },
    {
      name: 'drizzle',
      make: () => {
        const db = drizzle(client, { schema });
        return new DrizzleDecisionStore(
          db as unknown as ConstructorParameters<typeof DrizzleDecisionStore>[0],
        );
      },
    },
  ];

  for (const harness of harnesses) {
    describe(harness.name, () => {
      for (const scenario of SCENARIOS) {
        it(scenario.name, async () => {
          await scenario.run(harness.make() as never);
        });
      }
    });
  }
});

/**
 * The timeline's arithmetic, on its own.
 *
 * The parity scenario above asserts the two stores return the same timeline for
 * rows the clock produced — which proves they agree, not that the rule is the
 * one the daily screen needs. **A verdict decided at 23:59 on a Sunday is the
 * case that decides which week a boundary belongs to**, and no amount of
 * agreement between two stores can establish it. So the rule is tested here,
 * against rows with named instants, where every boundary is one somebody chose.
 */
describe('the timeline rule, against instants somebody chose', () => {
  /** A row with the fields the bucketing reads; everything else is filler. */
  function row(fields: {
    findingId: string;
    verdict: string;
    decidedAt: string | null;
    ownerId?: string | null;
  }): DecisionRecord {
    return {
      id: `row-${fields.findingId}`,
      projectId: PROJECT,
      findingId: fields.findingId,
      cell: null,
      verdict: fields.verdict as DecisionRecord['verdict'],
      ownerId: fields.ownerId ?? null,
      decidedAt: fields.decidedAt,
      note: null,
      deferUntil: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
  }

  it('anchors the week on Monday, in UTC, so a Sunday verdict is not a new week', () => {
    // 2026-10-11 is a Sunday. A week that started on Sunday would put this
    // verdict in its own week and the screen would show a week with one verdict
    // followed by an empty one — the loop looking busy on the day it was idle.
    const timeline = bucketTimeline(
      [row({ findingId: 'sunday', verdict: 'fixed', decidedAt: '2026-10-11T23:59:00.000Z' })],
      { findingIds: [], weeks: 2, at: '2026-10-12T09:00:00.000Z' },
    );
    // The week that began Monday 2026-10-05, not the week beginning 2026-10-11.
    expect(timeline.weeks.map((week) => week.week)).toEqual(['2026-10-05', '2026-10-12']);
    expect(timeline.weeks[0]?.counts['fixed']).toBe(1);
    expect(timeline.weeks[1]?.total).toBe(0);
  });

  it('keeps every week in the window, including the ones with no verdicts', () => {
    // **The sentence the daily screen prints — "a week with no verdicts is a
    // week the loop stopped" — is unprintable against a timeline that omits the
    // week.** An absent week reads as a week nobody looked at.
    const timeline = bucketTimeline(
      [row({ findingId: 'old', verdict: 'fixed', decidedAt: '2026-09-30T10:00:00.000Z' })],
      { findingIds: [], weeks: 4, at: '2026-10-12T09:00:00.000Z' },
    );
    expect(timeline.weeks.map((week) => week.week)).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ]);
    // Only the week of 2026-09-28 carries anything: the 30th is the Wednesday of
    // that week, and the September 21 week is empty rather than missing.
    expect(timeline.weeks[1]?.total).toBe(1);
    expect(timeline.weeks[2]?.total).toBe(0);
  });

  it('leaves a verdict decided before the window out of every week and owner', () => {
    const timeline = bucketTimeline(
      [
        row({ findingId: 'ancient', verdict: 'fixed', decidedAt: '2026-01-05T10:00:00.000Z' }),
        row({ findingId: 'recent', verdict: 'accepted', decidedAt: '2026-10-12T08:00:00.000Z' }),
      ],
      { findingIds: [], weeks: 2, at: '2026-10-12T09:00:00.000Z' },
    );
    expect(timeline.weeks[1]?.counts['accepted']).toBe(1);
    expect(timeline.owners).toEqual([{ ownerId: null, decided: 1 }]);
  });

  it('does not count an open row as a verdict in any week', () => {
    // An `open` row has no decision time — it is waiting, not history — and
    // counting it would inflate a week with rows nobody has called.
    const timeline = bucketTimeline(
      [row({ findingId: 'waiting', verdict: 'open', decidedAt: null })],
      { findingIds: [], weeks: 1, at: '2026-10-12T09:00:00.000Z' },
    );
    expect(timeline.weeks[0]?.total).toBe(0);
    expect(timeline.owners).toEqual([]);
  });

  it('ranks owners by how much they decided, with the name as the tie and unnamed last', () => {
    const timeline = bucketTimeline(
      [
        row({
          findingId: 'a',
          verdict: 'fixed',
          decidedAt: '2026-10-12T08:00:00.000Z',
          ownerId: 'ana',
        }),
        row({
          findingId: 'b',
          verdict: 'fixed',
          decidedAt: '2026-10-12T08:30:00.000Z',
          ownerId: 'bo',
        }),
        row({
          findingId: 'c',
          verdict: 'accepted',
          decidedAt: '2026-10-12T09:00:00.000Z',
          ownerId: 'bo',
        }),
        row({ findingId: 'd', verdict: 'accepted', decidedAt: '2026-10-12T09:30:00.000Z' }),
        row({
          findingId: 'e',
          verdict: 'accepted',
          decidedAt: '2026-10-06T09:30:00.000Z',
          ownerId: 'cy',
        }),
      ],
      { findingIds: [], weeks: 2, at: '2026-10-12T09:59:00.000Z' },
    );
    // Two each for bo and the others one each, and the tie goes to the name —
    // with `null` last, because a verdict recorded by nobody is the case the
    // screen should ask about rather than bury mid-list.
    expect(timeline.owners).toEqual([
      { ownerId: 'bo', decided: 2 },
      { ownerId: 'ana', decided: 1 },
      { ownerId: 'cy', decided: 1 },
      { ownerId: null, decided: 1 },
    ]);
  });

  it('answers exactly which derived findings have no row, once and in order', () => {
    const timeline = bucketTimeline(
      [
        row({ findingId: 'flaky-decision', verdict: 'open', decidedAt: null }),
        row({ findingId: 'flaky-decision-backend', verdict: 'open', decidedAt: null }),
      ],
      {
        findingIds: [
          'flaky-decision',
          'flaky-decision-backend',
          'pass-rate',
          'zero-caps-mean',
          'pass-rate',
        ],
        weeks: 1,
        at: '2026-10-12T09:00:00.000Z',
      },
    );
    // Two rows exist for two findings across two cells, so neither is
    // undecided; the duplicate id is counted once; the order is the caller's.
    expect(timeline.undecided).toEqual({
      count: 2,
      findingIds: ['pass-rate', 'zero-caps-mean'],
    });
  });
});
