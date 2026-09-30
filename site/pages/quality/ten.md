# Definition of done, as measured

The roadmap this repository grew ends with twelve falsifiable statements about the
product and the gates around it. Until now that list was the one number here with
no command behind it — every other claim has a gate behind it, and "10/10" had a
plan section.

`pnpm status:10` reports those twelve as `pass`, `fail` or `not_configured`. It is a
**measurement, not a gate**: the exit code is 0 whatever the verdicts are, because a
required check that can never pass blocks every pull request and teaches reviewers to
read red as noise. It graduates when the fails are zero, in the commit that makes
them zero.

Three properties make the table worth reading:

- **`not_configured` is a real answer.** Not checked, with a printed reason for why
  and for which parts did run. The register already ships honest `deferred` rows
  because of the same rule (decision **D15**).
- **Every row names the command that decides it**, so no verdict has to be taken on
  trust.
- **A point is its worst clause.** A point cannot be green because half of it was
  skipped, and a `debt` row with an owner and a removal condition converts a `fail`
  into a visible deferral rather than a quiet one.

<!-- generated: do not edit this block by hand -->

Generated from `pnpm status:10`, which reports the roadmap’s §17 "Definition of
done" as `pass`, `fail` or `not_configured`. `not_configured` is a legitimate
state — not checked, with a printed reason and the command that would check it —
and it is not a pass. Every row names what decides it.

The definition of done this repository can state honestly is **zero `fail` rows**.

| Point | Verdict          | Why                                                                                                                                                                                                                                                                                                                                                                                  | Decided by                                                                 |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1     | `not_configured` | not_configured: no CI job is deterministically red                                                                                                                                                                                                                                                                                                                                   | `pnpm test:integration`                                                    |
| 2     | `not_configured` | not_configured: `verify` and `verify:release` complete                                                                                                                                                                                                                                                                                                                               | `pnpm verify:local`                                                        |
| 3     | `fail`           | fail: a spec walks the durable chain; fail: the spec names every stage of the chain; not_configured: the chain is proven by a required run                                                                                                                                                                                                                                           | `pnpm test:e2e`                                                            |
| 4     | `not_configured` | not_configured: an accessibility check runs against the routes; not_configured: axe zero serious/critical on every one of 11 route file(s), in both themes; not_configured: every route has loading, empty, error and partial states                                                                                                                                                 | `pnpm test:e2e`                                                            |
| 5     | `not_configured` | not_configured: complexity ceiling is at most 10; not_configured: duplication is at most 3% on changed code; not_configured: mutation is at least 75% on the five core packages; not_configured: property or fuzz suites cover the stated invariants; not_configured: the authz matrix is generated from the application; not_configured: every performance budget is measured in CI | `pnpm complexity && pnpm duplication && pnpm coverage:ratchet`             |
| 6     | `not_configured` | not_configured: the instrumented product runs                                                                                                                                                                                                                                                                                                                                        | `pnpm test:runner`                                                         |
| 7     | `not_configured` | not_configured: every register row names a passing evidence command; not_configured: `capability:evidence` exists                                                                                                                                                                                                                                                                    | `pnpm docs:capability-register`                                            |
| 8     | `not_configured` | not_configured: the evidence and audit chain is complete and immutable                                                                                                                                                                                                                                                                                                               | `pnpm --filter @automate/api test src/infrastructure/vault-crypto.test.ts` |
| 9     | `not_configured` | not_configured: the migration graph is proven on a real database                                                                                                                                                                                                                                                                                                                     | `pnpm migrate:validate`                                                    |
| 10    | `not_configured` | not_configured: `pnpm docs:check` is green                                                                                                                                                                                                                                                                                                                                           | `pnpm docs:check`                                                          |
| 11    | `not_configured` | not_configured: the gate runs against a diff                                                                                                                                                                                                                                                                                                                                         | `pnpm review:pr --base main`                                               |
| 12    | `not_configured` | not_configured: the site is live and passes its ten checks                                                                                                                                                                                                                                                                                                                           | `SITE_DOCTOR_BUILT=1 pnpm site:doctor`                                     |

**0 pass · 1 fail · 11 not_configured**

- `fail` — checked, and it did not hold. Named.
- `not_configured` — not checked, with a printed reason for why and for which parts did run.
- `pass` — checked, and it held.

<!-- /generated -->
