# AUTOMATE (local) — toolbox, findings and AI (planning level)

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

Everything in this document is later than the first release. It is written down so the
first release does not make these harder, and so a reader can see what is deliberately not
built. Each item states the condition that must hold before it is started. Nothing here is
a capability of the product.

**Implementation note, 2026-10-19.** Part of this has since been built as dependency-free
code in [`local/`](../../local/README.md): the catalog and its schema check, recommendations
with evidence, the install preview through the runner, a set of deterministic findings with
dismissals, flakiness from history, and an AI interface with no model behind it. The items
below keep their original wording as the design. [implementation-status.md](./implementation-status.md)
says which parts exist, what their tests show, and which items are still not built (the
catalog update channel, three of the finding types, and any use of a model).

## Toolbox and recommendations

- Planned: a catalog of QA tools held as data only, one entry per tool with name, category,
  purpose, supported languages, a licence identifier with a source URL and a verified date,
  install and maintenance requirements, known limitations and documentation links.
  Precondition: the first release is accepted, and a schema for entries exists with a test
  that rejects any entry carrying executable content or an unknown field.
- Planned: the licence of every catalog entry defaults to "unverified" and is changed only by
  an entry that cites the licence file or an authoritative identifier and a date.
  Precondition: the catalog schema exists.
- Planned: repository detection, compatibility evaluation, recommendation rules, install
  instructions, install execution and post-install verification kept as separate stages.
  Precondition: the runner's consent path exists, because install execution reuses it.
- Planned: a recommendation that shows why it is relevant, the evidence from the repository,
  the expected benefit, the cost and maintenance burden, compatibility, alternatives, the
  steps, the files that would change, how to verify and how to roll back. Precondition: a
  recommendation with no repository evidence does not render.
- Planned: an installation preview listing every package manifest, lockfile, script,
  workflow or configuration change, confirmed explicitly, never applied silently.
  Precondition: the runner preview and consent design is implemented and its tests pass.
- Planned: catalog updates delivered as data, verified against a digest or signature the user
  can inspect, applied only on request. Precondition: the catalog schema and an update
  channel decision exist.

Absence of a tool is never offered as proof of a quality problem, and redundant tools are not
recommended without a reason stated.

## Cross-tool findings

Deterministic, evidence-based, and separate from anything AI produces.

Each finding states: the detection rule; the evidence required; a confidence; a severity
and a priority; how false positives are handled; the explanation shown; a suggested action;
how to verify it was fixed; and how it is dismissed or acknowledged. A correlation is never
worded as a cause.

- Planned: findings for a new failure compared with a previous comparable run, a duration
  change, a repeated failure, a missing or stale report, a configuration that prevents an
  expected report, an apparently absent test layer, duplicate or inconsistent results, and a
  change in reported coverage. Precondition: run history exists, and a run is comparable
  only when project, configuration, environment and scope match and the commit relation is
  known.
- Planned: flakiness from history. Precondition: enough comparable executions of one code
  state, with the minimum stated beside the label; nothing is called flaky from one run.
- Planned: a dismissal workflow that records who dismissed what and why, and keeps the
  dismissed finding visible on request. Precondition: the findings list exists.
- Planned: a correlation between a coverage change and a failure, shown as "observed
  together", never as a cause. Precondition: coverage and result history for comparable runs.

The first release already produces three honest observations that are not findings in this
sense: a report is partial, two reports of one execution disagree, and a report is older
than its neighbours. They are shown as facts with their evidence.

## AI strategy

Whether AI is worth its complexity is not decided. The product is complete without it, and
deterministic logic is used wherever it is sufficient.

- Planned: an optional layer for stack-trace summaries, failure clustering, root-cause
  hypotheses, plain-language explanations of gaps and recommendations, and natural-language
  questions over indexed evidence. Precondition: the first release has users, and there is
  evidence that a specific explanation task is not met by deterministic grouping.
- Planned: output grounded in cited evidence, with each claim linked to the stored result,
  line or file it came from, and labelled as a hypothesis when it is not a fact.
  Precondition: citation links exist in the interface.
- Planned: privacy boundaries: nothing leaves the machine without an explicit per-use
  choice, a local model option, and a visible preview of exactly what would be sent.
  Precondition: a data-flow review of every field that could be sent.
- Planned: defences against prompt injection from report content, which is untrusted:
  report text is delimited as data, never as instructions, and model output is never
  executed. Precondition: a hostile-report test set exists for the model path.
- Planned: cost controls and a clear off switch. Precondition: any remote model is in scope.

AI output cannot run a command, install a dependency or modify a file. Any resulting action
is proposed to the user and goes through the normal preview and consent (threat T-14).
