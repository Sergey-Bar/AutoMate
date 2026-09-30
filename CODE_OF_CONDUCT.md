# Code of conduct

## The short version

Be direct, be specific, and assume the other person is trying. Disagreement about a
decision is normal and is expected to be recorded; disagreement about a person is not
part of this project.

## What is expected

- **Argue with the evidence.** "That is wrong" is not a review comment; "`quality-gate.ts:104`
  reads the threshold but not the observed value, so the reason string is
  `threshold:98.2` against a threshold of 99" is. The repository's own convention is
  that every claim names the command or the path that decides it, and the same standard
  applies to a review comment about a decision.
- **State the band, not the mood.** A finding is a Blocker, a Critical, a Major, a
  Minor or a Nit, with a rationale and a fix. That vocabulary lives in
  `.github/review-rules/rules.json` and is enforced by `pnpm review:rules`, so using it
  is not a favour — it is how a finding becomes actionable.
- **Say when you do not know.** `not_configured` with a reason is a complete answer
  here. A confident guess that turns out to be wrong costs more than an honest gap.

## What is not acceptable

Harassment, personal attacks, sexualised language or imagery, and sustained disruption
of discussion. Also not acceptable: dismissing a report of a defect because it is
inconvenient, and re-litigating a closed decision without new evidence.

## The interesting case: a gate you think is wrong

A gate that reports a correct decision as a defect is a real failure in this
repository, and there are three documented cases of it. So is a gate that can only pass.

If you think a check is crying wolf, the response is to **narrow the check and prove
the narrowing**, not to delete it or to add a skip. Every gate in `scripts/` has a test
next to it that asserts the failure mode it exists to catch, and narrowing a check means
changing that test first — a test written only against the fixed code is not evidence.
Ledger `Q-1` and `C-6` are the worked examples: the first is a gate that fired on 30
findings, nearly all false, and the second is a register row that was asserting a
standard the product cannot meet.

## Scope

This applies in every space this project uses — issues, pull requests, discussions, and
the commit log — and to a person acting in any of them. Reports go to the maintainer
through the private route in [SECURITY.md](./SECURITY.md) when they concern a person
rather than the code.

## Enforcement

The maintainer is responsible for clarifying standards and enforcing this, and will
remove, edit or reject contributions that do not meet it, with the reasoning stated in
the thread. A report is answered. If a report concerns the maintainer, the GitHub
maintainer route is the escalation, and it is named here so nobody has to invent one.
