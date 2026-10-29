# AUTOMATE (local) — implementation status

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-29

What has been built in [`local/`](../../local/README.md), what its tests show, where it
departs from the rest of this blueprint, and what could not be checked. Where this document
and an older one disagree about whether something exists, this one is the later and the
more careful.

Nothing here is a capability of the server platform, and nothing here has been released.
The code is dependency-free Node (ESM with JSDoc types), outside the pnpm workspace globs.
Its tests run in `pnpm test:integration`, so `pnpm verify` and CI run every one of them.

## What exists

| Area                 | Requirements               | Where                                                        | What the tests show                                                                                                |
| -------------------- | -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Readers and model    | R-005, R-006, R-007, R-009 | `local/src/junit.mjs`, `playwright.mjs`, `lcov.mjs`          | Every corpus golden matches; hostile inputs are rejected or flagged; counts reconcile                              |
| Evidence store       | R-008                      | `local/src/store.mjs`                                        | Round trip is byte-identical; crash, tamper, full-disk and migration cases; derived rows rebuild from stored blobs |
| Reconciliation       | R-012                      | `local/src/reconcile.mjs`                                    | Duplicates, shards, two formats of one execution, and contradictions without a winner                              |
| Scanner and detect   | R-001 to R-004             | `local/src/detect.mjs`                                       | Read-only (tree digest unchanged), links not followed outside the repository, every finding has evidence           |
| Analysis             | R-010                      | `local/src/analysis.mjs`                                     | Metrics K-01 to K-13 match hand computation; a missing figure is null with a reason, never zero                    |
| Engine and interface | R-015, R-016               | `local/src/engine.mjs`, `server.mjs`                         | Token, Host and Origin checks, cookie sessions, no CORS, mutants of each check fail the tests; no network use      |
| Pages                | R-010 to R-014, R-020      | `local/src/ui*.mjs`                                          | Structure checks on every page and state; axe and keyboard reach in Chromium, both colour schemes; escaping        |
| Redaction            | R-017, R-018               | `local/src/redact.mjs`, `diagnostics.mjs`                    | Paths, user and host names removed from shown text; diagnostics written for inspection                             |
| Runner               | R-021 to R-026             | `local/src/runner.mjs`, `proctree.mjs`, `job-launcher.ps1`   | See below                                                                                                          |
| Toolbox              | R-027 to R-029             | `local/src/toolbox.mjs`, `local/catalog/tools.json`          | A catalog schema that rejects executable content; recommendations need evidence; installs go through the runner    |
| Findings             | R-030, R-031               | `local/src/findings.mjs`                                     | Rules, thresholds and wording are tested; dismissals persist across rescans of the same state                      |
| AI interface         | R-032                      | `local/src/ai.mjs`                                           | Interface only; see below                                                                                          |
| Cobertura, ZIP       | R-033 (one format), R-034  | `local/src/cobertura.mjs`, `zip.mjs`, `engine.importArchive` | Hand-written Cobertura fixtures parse; hostile archives are refused per entry; nothing is written to disk          |

The tests are in `local/test/`. The Node files run in `pnpm test:integration` on Windows and on
the ubuntu CI runner; `local/test/browser/` runs in Chromium through `pnpm test:local:browser`.
Key behaviours were also checked by deliberately breaking them
(for example removing the consent comparison, the environment allowlist, the redaction step,
the job-object assignment, the CRC check, the dismissal fingerprint) and confirming a test
fails. That is a spot check of the tests, not a proof they are complete.

### The runner

- Runs one command at a time, as an argument vector with no shell. On Windows a `.cmd` or
  `.bat` target goes through `cmd.exe` only when no argument holds a character `cmd.exe`
  would read; otherwise the request is refused at the preview.
- The preview returns a digest of the exact request. A start with a different digest is
  refused and records nothing.
- The working directory and expected report paths must resolve inside the repository, by
  resolved path, so a junction does not escape.
- The child gets an allowlist of operating-system variables plus the variables named in the
  request. Values of names that look like secrets are removed from output, as are values the
  user registers. Raw output is kept only until the run ends; only the redacted copy stays.
- A deadline is mandatory. A deadline, a cancel and an output limit each end the command and
  everything it started, and the runner checks that the process it started is gone.
- The preview says, in words, that execution is **not isolated**.
- History is kept; a run left running when the program stopped is marked interrupted at the
  next start, and its leftover raw output is redacted and the raw file removed.

Measured: on Windows, with a job object, a tree started through a `.cmd` launcher dies with
its root, and without the job object it does not. Not measured: any POSIX host. The process
group path is written and has never been run.

### The AI interface

There is no model, no network client and no way to turn it on from the launcher or the
pages. It is an interface: build the exact redacted prompt, show it, and send it only with
the digest of what was shown; keep report text in delimited data blocks; flag citations to
evidence that was not sent; return text and nothing that can act. A test reads the module's
source to confirm it imports no process, file or network API. Whether any AI explanation is
worth having is still undecided.

## Where this departs from the earlier documents

- **Pages are server-rendered HTML, not the React component library.** The dependencies for
  the React, Vite and Tailwind stack could not be installed where this was built. The
  pages carry no script (the content security policy allows one script, on the sign-in
  page), so they do not update by themselves: a running command shows a refresh link. An
  event stream exists on the server and no page reads it. [ADR-008](../adr/008-staged-delivery-engine-and-loopback-ui-first.md)
  and [ADR-012](../adr/012-node-engine-and-typed-loopback-interface.md) describe the stack
  as proposed; this is a stand-in that can be replaced without changing the engine.
- **The store uses the built-in SQLite module of Node,** not `better-sqlite3`. The
  measurement that [ADR-009](../adr/009-sqlite-and-content-addressed-evidence-store.md)
  asks for (M1-4) was not done, so that decision is still open.
- **There are no new packages.** The code is in `local/`, not in `packages/`. This avoids
  coverage-baseline rows, catalog dependencies and a second lockfile entry for code that
  could not be built with the workspace tooling, and it means the work in M1-3, M1-5 and
  M1-6 (creating packages) is not done.
- **The toolbox catalog has three entries,** each a plugin for a test tool the scanner
  already detects. Each cites a licence file read on 2026-10-19; those are the licence files
  of the project repositories, and the entry says the licence the package itself declares
  was not separately checked. Versions are not pinned, so an install takes the newest
  published version when the user confirms.
- **Findings cover part of the list in the toolbox document:** a new failure, a repeated
  failure, a duration change, flakiness from history, a missing and a stale report, and a
  coverage change worded as observed together with failures. Duplicate or inconsistent
  results as findings (they are still shown as facts on the dashboard), an apparently absent
  test layer, and a configuration that prevents an expected report are not built.
- **Team features: the decision is to build none now.** See
  [team-features-decision.md](./team-features-decision.md).

## MVP-0 exit criteria

Each criterion in the [PRD](./prd.md) and the test that fails if it stops holding.

| Exit criterion                                                                         | Test                                                                                                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No unknown, missing or incomplete outcome is reported as a pass                        | `corpus.test.mjs`: "an unknown, missing or incomplete outcome is never reported as a pass"                                         |
| Raw bytes read back with an equal SHA-256 for every golden fixture                     | `corpus.test.mjs`, `store.test.mjs`; `offline.test.mjs` downloads each original through the launcher and compares it               |
| Product plus indeterminate plus non-product outcomes equal the total, for every run    | `corpus.test.mjs`: "per-run counts reconcile"                                                                                      |
| A scan of a hashed tree leaves it unchanged                                            | `detect.test.mjs`, including read-only files; `offline.test.mjs` digests the tree around a scan through the launcher               |
| A report with zero tests is representable and shown as such                            | `analysis.test.mjs`, `corpus.test.mjs`; `ui.test.mjs` "dashboard, zero tests"; `offline.test.mjs` reads it on the served dashboard |
| The replacement readers produce the corpus goldens                                     | `corpus.test.mjs`: "every fixture matches its hand-authored golden"                                                                |
| Offline: starts, scans, ingests, shows the dashboard, and makes no outbound connection | `offline.test.mjs`: the real launcher under `offline-guard.mjs`, which refuses and records any TCP, DNS or UDP use but loopback    |

The guard is proved able to see what it is there to catch: the first test in
`offline.test.mjs` makes a connection, a lookup and a `fetch` under it and requires all three
in its record.

## What could not be verified

- **The repository's gates now run on `local/`,** except typecheck: no tsconfig includes it,
  so its JSDoc types are unchecked.
- **The real report adapters were not run** against the corpus (R-037, M1-1). The readers
  here are independent, small implementations.
- **Fixtures are partly synthetic.** The JUnit and lcov corpus includes output of the Node
  test runner. The Cobertura documents and every ZIP archive are built by the tests from the
  published formats; no coverage tool or CI system produced them.
- **No real package manager was run.** Install tests use stand-in programs that record how
  they were called.
- **Accessibility is checked by machine, not by people.** `local/test/browser/` runs axe
  (WCAG 2.2 A and AA) on every MVP-0 page in both colour schemes, and Tabs through a
  dashboard checking order and a visible focus. No screen reader has been used.
- **No performance figure exists.** Every limit, threshold and timeout is a proposal.
- **Phase 0 validation was not run** (R-036): the personas are still hypotheses.
- **Not built:** retention and history settings (R-019), a list of results per
  dashboard figure (R-011 is met in two steps: each figure links to the reports behind it,
  and each report page lists its tests and offers the original file), a
  Windows package and an upgrade test (M1-10), and the catalog update channel.

## Running it

```text
node local/bin/automate-local.mjs serve
node --test --test-concurrency=1 local/test/*.test.mjs
pnpm test:local:browser
```

`serve` prints an address with a one-time token after the `#`; open it in a browser on the
same computer. The Node test runner once hung on spawned children with piped output in the
environment this was first built in; the tests redirect child output to files, and they pass
under `node --test` on Windows and in CI.
