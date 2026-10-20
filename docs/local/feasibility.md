# AUTOMATE (local) — feasibility results

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

What was tried before the design was written down, what happened, and what it does and does
not show. Everything else in `docs/local/` that depends on a spike result points here.

Nothing in this document is a claim about the finished product. It is about the feasibility
code, which has since been moved into [`local`](../../local/README.md) and built on, and what
that code found out. [implementation-status.md](./implementation-status.md) describes what
exists now.

## Where this was run, and what that rules out

All results come from one machine: Windows, x64, Node v24.21.0. The shell it ran in had no
network access, no installed workspace dependencies and no package manager. Consequences:

- **The real report adapters were not run.** `packages/reporter` needs its dependencies. The
  spike used small independent readers so the model could be tested. Whether the real
  adapters match the goldens is **unverified** and is the first thing to check when the
  dependencies can be installed.
- **The XML parser the adapters use was not run against hostile input.** Its behaviour on
  entity expansion and external entities is **unverified**.
- **`better-sqlite3` was not installed or measured.** Only the SQLite module built into
  Node was exercised.
- **`taskkill`, `tasklist` and WMI queries fail in this sandbox.** Each exits non-zero with
  "The user name or password is incorrect" or "Access to a CIM resource was not available".
  The `taskkill /T` approach is therefore **not measured**; its rows below say so.
- **The repository's own gates were not run on the spike code**: formatting, lint, type
  check, duplication, complexity, dead-export and secret scans all need the workspace
  tooling. The code follows the conventions by hand and must be checked before it is
  committed.
- Only Windows was exercised. POSIX behaviour is described from documentation and marked
  unverified.

A result that only holds in this environment says so. A number is an observation on this
machine, not a target.

## Verdicts

`go` means the risk is retired for the question asked. `adjust` means the approach works but
the design must change or a stated gap must be closed first. `no-go` means stop. There is no
`no-go` below.

| ID     | Risk                                                              | Verdict | Evidence                                                                                                    |
| ------ | ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| RISK-1 | Several report formats normalise to one model without losing data | adjust  | [corpus test](../../local/test/corpus.test.mjs), [goldens](../../local/corpus/goldens.json)                 |
| RISK-2 | Duplicate and contradictory reports are handled deterministically | go      | [reconcile test](../../local/test/reconcile.test.mjs)                                                       |
| RISK-3 | Original evidence is preserved and ingestion is atomic            | go      | [store test](../../local/test/store.test.mjs)                                                               |
| RISK-4 | A timeout or cancel ends a command and everything it started      | adjust  | [process tree test](../../local/test/proctree.test.mjs), [measurement script](../../local/test/measure.mjs) |
| RISK-5 | Hostile XML cannot hang, expand, read files or reach the network  | adjust  | [corpus test](../../local/test/corpus.test.mjs), [limits test](../../local/test/limits.test.mjs)            |
| RISK-6 | SQLite can be the store with no server and no install step        | adjust  | [store test](../../local/test/store.test.mjs)                                                               |

## RISK-1: normalisation

**Question.** Can JUnit XML, Playwright JSON and lcov be read into one model, with unknown
staying unknown, nothing lost, and counts that add up?

**Method.** A corpus of fixtures, each with recorded provenance and a golden expectation
written by hand from the format rather than produced by the code under test. Two fixtures
are real tool output (the Node test runner's JUnit and lcov reporters, run on this machine);
the rest are handwritten, including edge cases: truncated, undefined entities, zero tests,
retries, duplicate names, Windows and unsafe paths, legacy encodings, garbage durations,
mismatched declared counts, and several projects in one Playwright report.

**Result.** Every fixture matches its golden. Properties asserted over the whole corpus: an
unknown or incomplete result is never reported as a pass; counts reconcile; raw bytes are
untouched by ingestion; a zero-test report is a result and not an error. The tests were
shown to fail when the defect they guard against is put back (an incomplete test read as a
pass, a pass reported over an incomplete report, a mapping row removed, an empty coverage
file reported as 0%).

**What the real tool output taught that the handwritten fixtures did not:**

- The Node runner's JUnit reports a test marked `todo` that fails as both skipped and
  failed, so the declared failure and skip counts overlap and do not sum to the test count.
  Counts must come from the elements, and a declared count is only a cross-check.
- Its `file` attributes are absolute Windows paths and its `hostname` is the machine name.
  Both are personal data. The fixtures had to be redacted before being committed, and the
  scanner must do the same before anything is shown, exported or shared.
- It writes a test that sits outside any suite directly under the root element. A reader
  that only looks inside suites loses it.

**Where the existing adapters differ, read from source and not run:** they refuse a report
with no tests; they collapse a JUnit `error` into `failed`; they ignore the Playwright
project name, so the same spec in two projects looks like two attempts of one test; and
they stamp a made-up path on a JUnit test that names no file. The full list is in
[data-contracts](./data-contracts.md).

**Limits.** The readers are throwaway code. Conformance of the real adapters, and of real
Playwright output, is unverified. The coverage fixtures come from one real producer.

**Verdict: adjust.** The model works, and it needs its own vocabulary: the server contract
cannot say what these fixtures need it to say.

## RISK-2: duplicates and contradictions

**Method.** A reconciler over ingested reports with the policy written in
`local/src/reconcile.mjs`, tested on fixtures that were built to need it.

**Result.** Byte-identical files are one artifact and counted once. One execution reported
in two formats is grouped, not merged, with a confidence and the limits of the evidence;
unknown commit lowers confidence and is stated. Reports from different commits are labelled
incomparable. Reports observed far apart in time, or with no tests in common, are not
grouped. A contradiction produces a disagreement entry with both outcomes and no chosen
winner. Shards add up, and a missing shard makes the run partial. Retries stay attempts.
Unreadable input is listed. Each rule was shown to matter by putting the opposite rule in
and watching a test fail.

**Limits.** The five-minute window and the fifty percent overlap are proposals chosen
without data from real CI systems. Cross-format matching uses file plus test name, so
reports that do not carry a file name match weakly. Grouping evidence comes from a context
the scanner would have to supply (commit, run key, shard); how it obtains each is not
shown.

**Verdict: go.** The rules are small and deterministic. The parameters need real data.

## RISK-3: raw evidence and atomic ingestion

**Method.** Raw bytes in a content-addressed directory, metadata in SQLite, ingestion in
one transaction, blob written and made durable before the transaction.

**Result.** Every stored report reads back byte-identical and its name is its digest. Ingest
is idempotent. A process killed with `SIGKILL` after the inserts and before the commit
leaves the earlier data intact and the interrupted ingest invisible, and the same report
ingests normally afterwards. A tampered or deleted blob is detected. A full disk (simulated
at the blob write) and a full database (the engine's own page limit) both report a clear
error and lose nothing already stored. A newer schema is refused and left untouched. A
migration copies the database first and a failing one rolls back. Derived rows can be
dropped and rebuilt from the blobs alone and come back identical.

**Two defects the tests found in the spike's own code:** SQLite rolls a transaction back by
itself when the database is full, and an explicit rollback after that threw and hid the
real error; and a store that failed to open during migration kept its files locked.

**Limits.** A simulated full disk is not a real one. One platform, one filesystem. Durability
under power loss is not tested.

**Verdict: go.**

## RISK-4: process-tree termination on Windows

**Method.** A process tree is started under each approach and then ended by timeout or
cancel, or by killing the supervisor. Liveness is checked per process id. The tree comes in
shapes that matter: directly launched, launched through a `.cmd` shim (the way package
managers launch tools), an intermediate that exits leaving an orphan, a descendant that
ignores termination signals, and a process that keeps spawning children.

**Measured on this machine** (survivors after ending the command; `-` means none):

| Approach      | Direct Node tree | Via `.cmd` shim | Orphaned descendant | Spawning storm | Ends within |
| ------------- | ---------------- | --------------- | ------------------- | -------------- | ----------- |
| Signal child  | -                | all three       | not run             | not run        | n/a         |
| `taskkill /T` | not measured     | not measured    | not measured        | not measured   | n/a         |
| Job object    | -                | -               | -                   | -              | about 30 ms |

And when the supervisor itself is killed: a direct Node tree dies with it; a shim-launched
tree survives; a detached tree survives; with the job object nothing survives.

**What this shows.**

1. **Signalling only the child, which is what the existing runner does, is not enough.** A
   command launched through a shim leaves every descendant running.
2. **Node already protects a plain all-Node tree, by accident.** On Windows it assigns the
   processes it starts to a job object that kills them when the parent goes, and the
   libuv source says so. That protection stops at the first launcher that is not a Node
   process, and does not cover detached children. It must not be relied on.
3. **A job object closes all of those gaps.** Everything started inside it is a member, an
   orphan stays a member, new children join it, and closing it kills them. Microsoft's
   documentation describes this behaviour for the kill-on-close limit and for default
   inheritance of membership.
4. **The cost is a helper process.** Node has no job-object API. The spike used a small
   PowerShell launcher that compiles a few lines of C# at start-up. It added roughly 0.4
   seconds to starting a command on this machine (three runs each: 143 to 158 ms against 522
   to 547 ms), it needs PowerShell and runtime compilation to be allowed, and its structure
   size is hard-coded for 64-bit Windows. A small shipped native helper, or a native
   addon, would avoid the start-up cost; neither was evaluated.
5. **`taskkill /T` could not be measured here.** By Microsoft's description it ends a process
   and the children it started, so it follows parent links as they exist when it runs.
   That predicts that an orphan, whose parent has gone, is out of reach and that processes
   created while it walks can be missed. This is reasoning from documentation, not a
   measurement, and the `measure.mjs` script reports `taskkill` rows as not measurements
   when `taskkill` fails.

**What this does not show.** Termination is not isolation. Everything the command could do
before it was ended it did: read files, change the repository, use the network, read the
environment. A job object limits lifetime, not access. A command can also leave the job
only by an explicit breakaway, which the launcher does not permit. Windows older than 8 do
not nest jobs; they are out of scope. POSIX (process group plus a signal, then a forced
kill) was not tested. The escalation timing, the log capture, and the effect of antivirus
or application allow-lists on the helper were not tested.

**Verdict: adjust.** Plain child signalling is rejected. A job object is the working design,
and the launcher mechanism is the open choice. See
[ADR-011](../adr/011-execution-safety-posture-no-isolation-in-the-first-release.md).

**Sources for the statements above that are not measurements:** S-01 and S-02 (job objects:
default inheritance, the kill-on-close limit, breakaway limits), S-03 (what the tree option
of `taskkill` is documented to do) and S-04 (Node's process library puts the processes it
starts in a kill-on-close job with silent breakaway), all in
[sources](./research/sources.md), read on 2026-10-19.

## RISK-5: hostile XML

**Method.** Nested-entity and external-entity documents, an oversized document, a very deep
document, a document over a test-count limit, a legacy encoding and invalid bytes.

**Result, for the spike's own reader.** A document type declaration is skipped without
being read, a custom entity stays literal text and marks the report as not well-formed, the
size, depth, element and test-count limits are enforced, and the reader's imports are
checked to contain no filesystem or network module. The nested-entity file ingests in
single-digit milliseconds with a small result, the external-entity file's target content
never appears in any output, and a loopback address named in it is never contacted because
nothing in the module can contact it.

**Limits.** This is a statement about a prototype. The parser `packages/reporter` uses was
not run on these files. Also, the caps in the adapters are on message length only; total
input size and test count are caps the caller must add.

**Verdict: adjust.** Before any reuse of the adapters, run the hostile fixtures through the
real parser and put the limits at the call site.

## RISK-6: SQLite driver

**Result.** The SQLite module built into Node v24.21.0 reported SQLite 3.53.4, accepted
write-ahead logging, full synchronous mode and foreign keys, supported strict tables and
transactions, and did not print an experimental-feature warning in this version. All the
storage behaviour above was exercised with it.

**Not shown.** `better-sqlite3` was not installed, so install behaviour on Windows without a
compiler, its performance, and a side-by-side comparison are all unmeasured. Whether the
built-in module is stable enough to depend on across Node versions was not assessed beyond
this one.

**Verdict: adjust.** Either driver is workable for the shape of data here. The choice is
still open and stays recorded in [ADR-009](../adr/009-sqlite-and-content-addressed-evidence-store.md).

## Changes this forces on the design

1. The local model keeps its own vocabulary, mapped one way from the server contract. This
   is [ADR-010](../adr/010-local-evidence-model-mapped-from-server-contract.md).
2. Counts are derived from result elements and never from a report's declared totals.
3. Personal data in reports (paths and machine names) is redacted at the edge, before
   display, export or diagnostics.
4. Identical identities with no retry evidence stay separate results and are flagged.
5. The runner must start commands inside a job object on Windows. Signalling the child is
   not an acceptable termination design.
6. Ingestion writes the blob first and commits second, and treats a transaction that the
   database has already rolled back as already rolled back.
7. Limits on bytes, depth, elements and tests are applied by the caller before and during
   parsing, and a limit hit makes the report partial or rejected, never silently shorter.

## Reproducing

From the repository root, each file runs on its own:

```text
node local/test/corpus.test.mjs
node local/test/limits.test.mjs
node local/test/reconcile.test.mjs
node local/test/store.test.mjs
node local/test/proctree.test.mjs
node local/test/measure.mjs
```

The Windows process tests start and end real processes and take under a minute. The last
command prints the table above for the host it runs on, and on a host where `taskkill`
works it fills in the rows this one could not.

## Spike code: where it lives and when it goes

It was moved, not copied, into `local`, outside the workspace globs, with no dependencies, and
it is now the base of the implementation described in
[implementation-status.md](./implementation-status.md). It is not built, type-checked, covered
or published by any gate. The root lint, format, duplication and complexity globs do reach it,
and they could not be run here.

**Removal condition.** The spike code no longer exists as a separate directory. What remains
to be done is the condition below, which now reads: the code in `local` is replaced by a
package under `packages/` or `tools/`, in the same change that adds a test that reads the
corpus goldens and runs them through the real adapters, and tests equivalent to the
process-tree and storage tests above. Until then `local/test` is the only place those proofs
exist.

**Before it is committed:** run formatting, lint, type check, the duplication and complexity
gates and the secret scan over it, and confirm the fixture files that look like secrets are
not (the sentinel text is a plain marker string).
