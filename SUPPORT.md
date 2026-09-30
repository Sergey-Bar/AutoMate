# Support

## A bug, or a capability request

The distinction matters because the two have different answers and different timelines,
and this repository treats them differently on purpose.

**A bug** is a claim that something the repository says it does, it does not. The
register at `docs/migration/capability-register.md` is the authority on what the product
can do, and every row carries a status:

| Status     | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| `real`     | Implemented, with implementation and test evidence.          |
| `mock`     | A boundary exists and the boundary is named. Not production. |
| `missing`  | Named, not built. The plan decision is cited.                |
| `deferred` | Deliberately not built for this release, with an owner.      |
| `obsolete` | Superseded by something else in the tree.                    |

If a row says `real` and the code does not do it, **that is a bug and it is a
high-priority one**: the product's central claim is that it never overstates, and a
`real` row that overstates is the claim failing. Open an issue against the row id.

**A capability request** is a request for something no row claims. It is a conversation
about scope, and the first thing it needs is the register row's status changed to
`missing` or `deferred` with a rationale — not code. Adding a row is a one-line change
and it is how a request becomes visible before anybody builds it.

## Where to put it

- **A defect** → an issue, with the command that reproduces it. `pnpm status:10` and
  `pnpm review:pr` both name the command that decides most of the claims in this
  repository, so a report that starts with one of those is already half triaged.
- **A security issue** → **not** an issue. See [SECURITY.md](./SECURITY.md); the private
  route and the response window are there.
- **A QA gap** → an issue tagged as such, naming the domain. Four of the five execution
  domains answer an explicit `501 NOT_CONFIGURED`, and a domain that is not configured
  is a _capability_ state rather than a defect, so the two are kept apart deliberately.
- **A question about the product's limits** → the answer is the generated capabilities
  page, which cannot claim more than the register says.

## What support is not

- **Not a promise of work.** This is a self-hosted product built to a plan of record.
  An issue is triaged, not scheduled.
- **Not a second ledger.** If your report is a confirmed defect, it belongs in
  `docs/quality/findings-ledger.json`, which is machine-checked by `pnpm findings:check`
  and published as a site page. A duplicate record in two places is a record that can
  disagree with itself.
- **Not a place to argue about architecture.** That is a pull request or a decision
  record, and the decision records are in `docs/adr/` with a status and a supersession
  link.

## What you can do yourself

Most of what a support question turns out to need is a command:

```bash
pnpm status:10          # the twelve points, each with the command that decides it
pnpm review:pr --base main   # the merge gate, against your branch
pnpm review:rules       # can the reviewer's policy even be loaded
pnpm findings:check     # the ledger's own rules
pnpm docs:check         # every claim the documentation makes about the code
```

Each reports `pass`, `fail` or `not_configured` with a reason. A `not_configured` is not
a pass and not a failure — it is the answer "this was not measured, here is why, and
here is what would measure it", and the rule that makes those three outcomes the whole
vocabulary is in `docs/adr/004-native-reporting-not-allure.md`.
