# AUTOMATE (local) — team and shared features: decision

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

The decision for requirement R-035, which Phase 5 asks to be written down: **no team or
shared feature is built now.** This records why, and what would change that.

## Why not now

- **No evidence of demand.** The personas are hypotheses and the Phase 0 validation
  (R-036) has not been run. The one open question about teams in
  [users and workflows](./users-and-workflows.md) is whether a team that cannot use hosted
  services exists in useful numbers (hypothesis H-4 in the
  [landscape](./research/competitive-landscape.md)). Nothing answers it yet.
- **A shared product already exists.** [ADR-007](../adr/007-local-product-separate-from-server-platform.md)
  keeps this product separate from the server platform, which is the multi-user, hosted
  product. Building sharing here would grow a second, weaker copy of it.
- **Sharing changes the security model.** Everything in the
  [threat model](./runner-and-threat-model.md) assumes one user on one computer: a loopback
  listener, a per-launch token, and a runner that is not isolated and runs as that user.
  A second person reaching the same data, or a command started on behalf of another person,
  would need a different model, and that is a design task of its own, not an extension.
- **The local product has not been used yet.** What users do with a single-user dashboard
  is the best evidence of what sharing they would want, and it does not exist.

## What exists instead

A repository's reports can be exported as the original files, and a CI artifact archive can
be imported (R-034). Two people can therefore look at the same evidence by exchanging the
reports themselves, with the redaction the interface applies on display.

## What would change this decision

All of these, together:

1. The Phase 0 validation shows a repeated, specific need that a team states without being
   prompted.
2. A written decision says whether that need is better met by the server platform, by an
   export format, or by something new, with the threat model for the second user.
3. The single-user product has users whose behaviour shows what is shared in practice.

Until then, the answer to a request for shared features is: use the server platform, or
exchange the original reports.
