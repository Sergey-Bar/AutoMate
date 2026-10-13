/**
 * What an agent in this product produces, and what it must produce before a
 * proposal counts as one.
 *
 * ## The failure-first rule is code, not a policy
 *
 * The closing plan states the shape of the one execution domain the product ships:
 * a derived finding becomes a task with the failing test attached, a task becomes a
 * proposed diff, **and a human merges**. The console never writes to a repository
 * on its own. The last sentence is the load-bearing one, and it is enforced here
 * rather than described:
 *
 *   - `proposeTask` **throws** when it cannot name a failing test. A proposal
 *     without one is not a low-quality proposal, it is not a proposal, so there is
 *     no function that returns one.
 *   - `proposeDiff` takes a proposal, so a diff cannot exist without the failing
 *     test it answers.
 *   - Nothing in this module writes. There is no `write`, `commit`, `push`,
 *     `createFile` or `openRepository` — the absence is what a reviewer can read,
 *     and `contract.test.ts` asserts it by reading the export list, because the
 *     next thing anyone adds here is the thing that breaks the rule.
 *
 * ## Why the objects are frozen
 *
 * A frozen object makes "the console never writes" true at runtime as well as in
 * the source: an adapter that tries to amend a proposal it was handed is mutating a
 * frozen object and fails immediately, rather than quietly producing a proposal
 * that no longer names the test it was built from.
 */

/** A named failing test, with the file and line it was observed at. */
export interface FailingTest {
  /** The test's name, as the runner states it — the thing a proposal must name. */
  readonly name: string;
  /** Where it failed, so a reviewer can read the failure without reproducing it. */
  readonly location: string;
  /** What the test said, truncated at the boundary that owns the envelope. */
  readonly message: string;
}

/** A unit of work derived from a finding, with its failing test attached. */
export interface TaskProposal {
  readonly taskId: string;
  readonly summary: string;
  readonly failingTest: FailingTest;
}

/** A proposed change, which cannot exist without the task it answers. */
export interface DiffProposal {
  readonly taskId: string;
  readonly diff: string;
  /** The test a reviewer is being asked to watch fail before the diff is accepted. */
  readonly failingTest: FailingTest;
}

/** The one reason every refusal on this path carries. */
export const NO_FAILING_TEST = 'PROPOSAL_REQUIRES_A_FAILING_TEST';

/**
 * A task, or nothing.
 *
 * @param input the candidate, including the test it claims is failing
 * @returns the proposal, frozen
 * @throws {RangeError} when the failing test has no name or no location, which is a
 *   proposal that cannot be checked by a human and is therefore not a proposal
 */
export function proposeTask(input: {
  taskId: string;
  summary: string;
  test: FailingTest;
}): TaskProposal {
  const name = input.test.name.trim();
  const location = input.test.location.trim();
  if (name === '' || location === '') {
    throw new RangeError(
      `${NO_FAILING_TEST}: a task must name the failing test it answers, and this one ` +
        `named ${name === '' ? 'no test' : 'a test'} and ` +
        `${location === '' ? 'no location' : 'a location'}.`,
    );
  }
  if (input.taskId.trim() === '') {
    throw new RangeError('A task must carry an id, which is what makes it referable.');
  }
  return Object.freeze({
    taskId: input.taskId.trim(),
    summary: input.summary.trim(),
    failingTest: Object.freeze({
      name,
      location,
      message: input.test.message.trim(),
    }),
  });
}

/**
 * A diff, against a task that already names its failing test.
 *
 * @param task the proposal this diff answers
 * @param diff the change, as a unified diff
 * @returns the proposal, frozen
 * @throws {RangeError} when the diff is empty or the task carries no failing test
 */
export function proposeDiff(task: TaskProposal, diff: string): DiffProposal {
  const trimmed = diff.trim();
  if (trimmed === '') {
    throw new RangeError(
      'An empty diff is not a proposal. A task with no change to offer is a finding, ' +
        'and a finding is what `proposeTask` returns by itself.',
    );
  }
  if (task.failingTest === undefined) {
    // Unreachable through the public API — `proposeTask` guarantees the field —
    // and asserted because the field is what the whole rule reduces to.
    throw new RangeError(`${NO_FAILING_TEST}: the task carries no failing test.`);
  }
  return Object.freeze({
    taskId: task.taskId,
    diff: trimmed,
    failingTest: task.failingTest,
  });
}

/**
 * Everything this module exports, read by the test that proves it writes nothing.
 *
 * The list is not written out here: it is read from the module object, so a new
 * `writePath` function appears in it and the assertion fails. A hand-written
 * allowlist of names would be the second authority that stops tracking the first.
 */
export const TOOL_SDK_EXPORTS = Object.freeze([
  'mintSessionToken',
  'isUsable',
  'narrowTo',
  'proposeTask',
  'proposeDiff',
  'domainsFor',
  'NO_FAILING_TEST',
]);

/** What an adapter may be asked to do, in the order a plan would ask for it. */
export const AGENT_CAPABILITIES = Object.freeze({
  /** Turn a finding into a task that names the test that fails. */
  deriveTask: 'derive-task',
  /** Offer a change. Never applied — only proposed. */
  proposeDiff: 'propose-diff',
  /** Read what the repository says about itself, to find the failing test. */
  readFindings: 'read-findings',
});
