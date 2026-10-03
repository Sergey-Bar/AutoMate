---
title: Quality
description: The four pages that report what the repository knows rather than what it hopes.
---

# Quality

Everything here is generated from a file in the repository, and **the generation is
checked**. `pnpm site:doctor` fails if a published page disagrees with its source, and
`pnpm docs:check` fails if a generated page is stale. That is why these pages can be
trusted to be current even though nobody edits them by hand.

| Page                               | Generated from                           | What it reports                                                                     |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| [Capabilities](../capabilities.md) | `docs/migration/capability-register.md`  | Every capability and its status — `real`, `mock`, `missing`, `deferred`, `obsolete` |
| [Findings](findings.md)            | `docs/quality/findings-ledger.json`      | Every confirmed defect, its band, its owner, and the path behind each `fixed` row   |
| [Coverage](coverage.md)            | the measured run of every package        | Real floors, per package, and the ratchet that only lets them rise                  |
| [10/10](ten.md)                    | a twelve-point contract, recomputed here | Twelve claims, each naming the command that would decide it                         |

::: info `not_configured` is a real answer
Three of these pages report `not_configured` rather than `pass` for some rows, and a
page that says "we did not check this" is more useful than one that says "fine".

That distinction is the point of the whole quality section: a gate that cannot run must
say so, because a gate that reports `pass` for something it did not do is the failure
this repository keeps having to record.
:::
