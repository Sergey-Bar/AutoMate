# AUTOMATE (local) — UX specification

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

What the first release's screens show, in every state, and the rules the interface follows.
The look comes from the existing design language; this document says what to show and how
uncertainty is communicated, not how it is coloured.

## Principles

- **Say what is known, what is missing and how sure.** Freshness, completeness and
  provenance are shown beside every number, not behind a link.
- **Missing is not zero.** A value that is not there is shown as missing, in words.
- **Density without clutter.** Tables are the main form; charts appear only where they
  support a decision, and every chart has a table behind it.
- **Immediate feedback**, minimal motion, and no decoration that carries no information.
- **Never imply safety that is not there.** Anything that would run code says so plainly.

## Design system

Reuse `packages/ui` and its design language: colour is a token, never a literal; no
backdrop-filter or glass; the animation names the library defines; icons only through the
library's icon list. Status is never colour alone: every status has a word and a shape.
Dark and light themes, a visible focus ring on every interactive element, and contrast that
passes an automated check. Spacing, type and tokens are the library's and are not restated
here.

Status vocabulary shown to users matches [data contracts](./data-contracts.md): passed,
failed, errored, skipped, timed out, unknown, not run, aborted, infrastructure error. Run
completeness (complete, partial, unknown, rejected) is shown as a badge with the reason.

## Navigation and keyboard

Left navigation: Dashboard, Repositories, Reports, Settings. Runner, Toolbox and History
appear as items only when they exist. Every action is reachable by keyboard; a command
palette lists actions; tables support arrow-key row movement, Enter to open and a visible
sort state. Shortcuts are listed in a help overlay and never conflict with the browser or
the operating system.

## Screens in the first release

### Screen: Repository onboarding

Purpose: choose a repository and see what was discovered before anything else.

**Loading.** A scan in progress shows the current directory counts and a Cancel button; no
number is shown as final.

**Empty.** No repository chosen: one button to choose a directory, one sentence on what the
scan does and that it only reads.

**Error.** The path was refused: the reason (not a directory, unreadable, a filesystem
root), and what to do.

**Partial.** The scan stopped at a limit or was cancelled: what was found so far, which limit,
and an action to rescan with a higher limit.

**Success.** Projects, tools and report locations found, each with its evidence and
confidence, and a clear statement that nothing was run and nothing was written.

### Screen: Dashboard

Purpose: the state of testing evidence in the repository, with trust attached.

```text
+--------------------------------------------------------------+
| Repository name      scanned 12 min ago      [Rescan]        |
+--------------------------------------------------------------+
| Reports found 9 | read 7 | not complete 2 | rejected 1  (K-11, K-10) |
+--------------------------------------------------------------+
| Tests by outcome (K-02)        | First-pass rate (K-03)       |
| [bar + counts, unknown apart]  | 91.2%  of 1,204 product attempts |
|                                | excluded: 31 unknown, 4 not run |
+--------------------------------+------------------------------+
| Coverage (K-08)                | Freshness (K-09)             |
| lines 87.8%  functions 77.8%   | newest report 12 min,        |
| branches  not reported         | oldest 9 days (highlighted)  |
+--------------------------------+------------------------------+
| Disagreements (K-13)           | Tools detected (K-12)        |
+--------------------------------+------------------------------+
```

The figures in the sketch are layout examples, not data.

**Loading.** Skeletons in the shape of each card; no number appears until it is final.

**Empty.** No reports found: what was discovered (tools, locations) and one safe next action,
for example pointing at a report folder. No zeros are shown.

**Error.** The store could not be read: the stable error code and what to do; nothing else
is shown as if it were current.

**Partial.** Some reports are not complete or not read: a banner states how many and why,
and the numbers say they cover only the readable reports.

**Success.** Every card shows its value, denominator, freshness and a link to the detail.
Contested or incomplete data is marked on the number it affects.

### Screen: Report detail

Purpose: everything about one report and the results in it, down to the file.

**Loading.** The header and a skeleton table.

**Empty.** A readable report with no tests: "this report contains no tests", with its other
facts, not an empty table.

**Error.** The stored copy is missing or its digest does not match: this is stated, with the
path it was found at, and the derived results are marked as untrusted.

**Partial.** The report was cut short or hit a limit: the results present are listed, the
last test is marked unknown, and the warning codes are explained in words.

**Success.** Format, completeness, every location of the same bytes, warnings, and a table of
results with outcome, attempts, duration and message, filterable by outcome. A button opens
the raw file as stored.

## Screens that come later

Defined here only so the first release leaves room for them.

### Screen: Runner

Planned: Phase 2. Shows detected, configured, ready, running and completed states for each
candidate command, the exact command, directory and environment names before running,
live output, progress, duration, cancel and timeout, and a plain statement that execution is
not isolated.

**Loading.** Discovering candidate commands.

**Empty.** No runnable command was found, with the reasons.

**Error.** A run could not start or was lost, with the code and the cleanup state.

**Partial.** A run ended unsuccessfully but produced results; both are shown.

**Success.** The run, its exit status, its artifacts and the dashboard figures it changed.

### Screen: Toolbox

Planned: Phase 3. A catalog and evidence-backed recommendations with an install preview.

**Loading.** Reading the catalog.

**Empty.** Nothing recommended, and why that is not a finding.

**Error.** The catalog failed validation; nothing from it is shown.

**Partial.** Some entries have unverified licences and say so.

**Success.** Recommendations with evidence, cost, alternatives and the exact files a change
would touch.

### Screen: Execution history

Planned: Phase 2. Every run with command, scope, times, exit status, termination path and
artifacts.

**Loading.** Reading the history.

**Empty.** No runs yet.

**Error.** The history could not be read, with the code.

**Partial.** Runs whose artifacts were deleted are listed as such.

**Success.** A sortable table and a detail view that can reproduce the run.

## Messages

Errors name what happened, what it means for the numbers on screen, and what to do. They do
not show a stack trace, a secret or a path outside the repository. Success messages say what
was done and what was not (for example "ingested, nothing was changed in the repository").

## Accessibility

Keyboard operation for everything; semantic structure; labelled controls; visible focus;
status conveyed by text and shape as well as colour; live regions for progress; reduced
motion respected; an automated accessibility check in the test suite for each screen in each
state, plus a manual screen-reader pass before release.

## Responsive behaviour

The first release targets a desktop-width window. Narrower widths collapse the navigation and
stack the cards in a single column; tables scroll horizontally with a sticky first column.
