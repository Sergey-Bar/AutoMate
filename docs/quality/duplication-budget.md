# Duplication budget

The 3% duplication ceiling, what it measures, and how the gate came to measure
nothing for months.

## The number

`pnpm duplication` reports duplication across the maintained source tree. At the
time of writing: **1.40%** of lines across 275 files, 30 clones — recorded in
`docs/quality/duplication-baseline.json`, with the threshold itself in
`.jscpd.json`.

The baseline file is the _measured value for review_. The authority is the
threshold in `.jscpd.json`, which the gate reads. Re-record with
`pnpm duplication:baseline`.

## What is in scope, and why

`.jscpd.json` scans `apps`, `packages`, `tools`, `scripts`, `tests` and `e2e` for
TypeScript and TSX.

Two exclusions are judgements worth stating:

- **Tests are excluded.** Two table-driven suites asserting the same rule from
  opposite directions is a feature, not a clone. A budget that counts them pushes
  authors to weaken assertions rather than to share a helper.
- **Generated output is excluded** — `dist/`, `build/`, `coverage/`, `var/`,
  `test-results/`, and the `*.d.ts` declarations Drizzle and TypeScript emit.

Whole-repository duplication reads far higher, around 30%, because it counts YAML,
Markdown and lockfiles. That is not what a duplication budget is for.

`.mjs` gate scripts are not scanned: jscpd's `typescript` parser does not read
JavaScript, and a format that matches nothing silently contributes nothing. The
`javascript` format is listed for `.mjs`, but those files are small and their
duplication is covered by the ESLint and review gates.

## How this gate measured nothing, and how it stopped

`pnpm duplication` was `jscpd --config .jscpd.json`. That command printed
**"Found 0 clones"** and exited 0, and it did so for the entire life of the gate.

jscpd 5 has no output for "I saw no files". It reports an empty analysis exactly as
it reports a clean one, and the exit status is 0 either way. So the gate reported
0.00% duplication, indefinitely, and every number it produced was a measurement of
nothing. This is the repository's central failure mode — a gate that cannot fail —
sitting in the one gate whose job is to count.

Four separate causes, each sufficient on its own to produce an empty scan:

1. **`$comment` in the config.** jscpd 5 validates its config strictly and rejected
   the whole file on that key. A comment key in a tool config is not a comment; the
   tool reads it as a typo in a setting. The rationale that used to live there is
   now in this file, which is where a comment belongs.
2. **No `format`.** jscpd 5 requires an explicit format and no longer infers one
   from file extensions. Without it, `formats` resolves to `[]`, jscpd has no
   parser for any file, and the analysis is empty. The CLI flag is `--format`; the
   config key is `formats`.
3. **`absolute: true`.** With this `ignore` list, resolving paths to absolute form
   made every source file fail the ignore match. 11 clones with the key, 0 without.
4. **No paths on the command line.** jscpd 5 takes its targets from argv. A config
   alone scans nothing.

And one more, in the gate rather than the tool:

5. **A stale report.** jscpd does not clear its output directory, so a run that
   failed on a bad argument left the previous run's `jscpd-report.json` in place.
   The gate read it and reported a healthy 0.00% for a scan that never happened.
   The gate now deletes the previous report before running, so a report can only
   ever describe the run that just finished.

## Why the gate is a wrapper and not `jscpd` directly

Because the exit status cannot carry the verdict. jscpd exits 0 for a clean tree
_and_ for an empty analysis, and those states are indistinguishable from outside.
The gate reads `statistics.total.sources` from the report and treats zero files as
a **failure**, because a gate that cannot see the code has not passed.

`scripts/lib/duplication-gate.mjs` holds that decision, free of `node:fs` so it can
be tested. It has eight tests covering an empty analysis, a clean tree, a tree over
budget, a threshold exactly at the limit, a non-zero exit with an in-budget number,
a missing scanner, and a truncated or hostile report. Reading the decision inline
would have left it untestable, which is how the original defect survived: nobody
could demonstrate this gate failing without uninstalling jscpd and reading its
console output.

## Three outcomes

| Outcome          | Meaning                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `pass`           | Files were analysed, and duplication is within the threshold. The message says how many.                       |
| `fail`           | Files were analysed and duplication exceeds the threshold, **or** no files were analysed, **or** jscpd failed. |
| `not_configured` | jscpd is not installed. Printed with the reason. Never a pass.                                                 |
