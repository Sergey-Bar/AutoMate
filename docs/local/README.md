# AUTOMATE (local) — blueprint index

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

This directory is the blueprint for **AUTOMATE (local)**: a local-first, offline-capable
product that discovers a repository's testing ecosystem, ingests existing test evidence
into one model, reports what that evidence does and does not show, and (in later phases)
runs tests with the user's consent.

A dependency-free implementation of most of it exists in [`local/`](../../local/README.md), and
[implementation-status.md](./implementation-status.md) says what it does, where it departs from
these documents and what could not be checked. Nothing here is a capability claim about the
server platform; the capability register stays the authority for what that product does.

## Which product a document describes

| Name                | Meaning                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| AUTOMATE (local)    | The product this directory designs. Provisional name; final naming is an open question.          |
| The server platform | The existing Hono, Effect and PostgreSQL product in `apps/` and `packages/`. Separate, optional. |

The decision and the reuse policy are in [ADR-007](../adr/007-local-product-separate-from-server-platform.md).
Delivery staging is in [ADR-008](../adr/008-staged-delivery-engine-and-loopback-ui-first.md).

## Claim classes

Every statement of fact about the outside world, and every statement about what the
design will do, carries one of these classes where a reader could mistake one for another.

| Class          | Meaning                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `verified`     | Read from an official source or reproduced by a test in this repository. Cited, with an access date or a path. |
| `vendor-claim` | Stated by the vendor or project and not tested here. Never placed in a "verified" column.                      |
| `hypothesis`   | A belief about users or behaviour with a stated way to test it.                                                |
| `assumption`   | A provisional choice made to continue. Labelled, and listed where it is made.                                  |
| `proposal`     | A design choice offered for decision.                                                                          |

A source that could not be read is `unverified`. A gap is never filled from memory.

## Wording rule for things that do not exist yet

Write "Planned:" or "Proposed:" at the start of a sentence about a capability that has not
been built. The documentation drift gate treats availability wording about an unbuilt
capability as a finding, and the rule is right: a blueprint that reads like a feature list
is how a reader ends up believing it.

## Header convention

Every document in this directory starts with a title and three bold lines: `Status`
(Draft, Proposed or Accepted), `Owner`, and `Last reviewed` as an ISO date.
`scripts/lib/blueprint-consistency.test.mjs` fails on a document without them.

## The gate

`scripts/lib/blueprint-consistency.test.mjs` runs inside `pnpm docs:check`, with its checks in
`scripts/lib/blueprint-consistency.mjs`. It checks structure and agreement:

- this set is reachable, and every document has its header;
- every ADR cited here has a file and a row in the ADR index;
- every fixture in the spike corpus has provenance and a golden, and no file is orphaned;
- the status mapping table lists exactly the statuses the server contract has, read from the
  contract's source;
- every feasibility verdict is one of go, adjust or no-go, with evidence that exists;
- every source in the register has an https URL, a date and a class, every citation resolves,
  and no table cell presents a vendor claim without saying it is claimed;
- requirements have unique ids, a phase, a persona that exists and a criterion; the roadmap
  schedules each one in the phase the PRD names;
- every KPI has its ten fields, validates against real fixtures, and every metric the
  reporting policy computes is accounted for;
- every threat has a mitigation and an owner; every failure scenario has behaviour, recovery
  and verification; every screen states all five states; every planned item states its
  precondition; every architecture decision cites a record.

It checks structure and agreement. It does not prove a conclusion is correct. The proofs of
conclusions are the tests that run against fixtures, and `feasibility.md` says which of
those exist and which could not be run.

## Documents

Documents are added as they are written. A document that is listed here exists.

| Document                                                                 | Purpose                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [README.md](./README.md)                                                 | This index and the conventions.                                                         |
| [prd.md](./prd.md)                                                       | Vision, the smallest first release, requirements with ids, non-goals.                   |
| [users-and-workflows.md](./users-and-workflows.md)                       | Personas as hypotheses and the Phase 0 validation plan.                                 |
| [research/competitive-landscape.md](./research/competitive-landscape.md) | What exists, what is verified and what is claimed, and where this could differ.         |
| [research/sources.md](./research/sources.md)                             | The source register: every external fact cites a row here.                              |
| [feasibility.md](./feasibility.md)                                       | What the spikes showed, and what they could not.                                        |
| [data-contracts.md](./data-contracts.md)                                 | Entities, status vocabulary, mapping from the server contract, reconciliation, storage. |
| [kpi-dictionary.md](./kpi-dictionary.md)                                 | Every metric: formula, missing-data rule, validation fixtures.                          |
| [discovery-engine.md](./discovery-engine.md)                             | The read-only scanner and the detector contract.                                        |
| [runner-and-threat-model.md](./runner-and-threat-model.md)               | The runner design, what it does not promise, and the threat table.                      |
| [architecture.md](./architecture.md)                                     | The shape, the decisions and the alternatives.                                          |
| [toolbox-and-intelligence.md](./toolbox-and-intelligence.md)             | Later work: catalog, findings and optional AI, each with its precondition.              |
| [ux-spec.md](./ux-spec.md)                                               | Screens in every state, and the interface rules.                                        |
| [quality-and-observability.md](./quality-and-observability.md)           | Acceptance criteria, targets that are not yet measurements, tests, logging.             |
| [risks-and-adversarial-review.md](./risks-and-adversarial-review.md)     | Failure scenarios, the evaluation, and the open decisions.                              |
| [roadmap.md](./roadmap.md)                                               | Phases, definitions of done, and the first milestone.                                   |
| [implementation-status.md](./implementation-status.md)                   | What is built in `local/`, how it departs from the design, and what is unverified.      |
| [team-features-decision.md](./team-features-decision.md)                 | The written decision for R-035: no team features now, and what would change that.       |

Decision records: [ADR-007](../adr/007-local-product-separate-from-server-platform.md) to
[ADR-012](../adr/012-node-engine-and-typed-loopback-interface.md), all proposed.
