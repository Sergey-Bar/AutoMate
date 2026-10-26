# SDLC and ADLC health and quality platform

Decided with the repository owner on 2026-10-26: cover every area of a repository's health —
how it ships, what it ships, whether its tests catch anything, what AI-written change does to
it, and whether its agents regress — with CI pushing reports and the server pulling delivery
data from GitHub. New signals are scorecards beside the grade and count in it only when a
project's policy weights them (invariant HEALTH-3).

## Rules every wave kept

- Not configured, insufficient and missing evidence are never a pass, in a scorecard or a
  gated input.
- No per-person data: delivery and AI-code analytics are per repository, team or agent.
- Prompt and trace content is not stored by default.
- Bands and signatures are versioned constants with their sources (DORA 2024 bands in
  `packages/reporting/src/dora.ts`, agent signatures in
  `packages/reporting/src/ai-attribution.ts`).
- Every table is workspace-scoped with an isolation test; every route is guarded.

## Waves

0. **Foundation.** Five opt-in dimensions at weight 0 and the scorecard contract
   (`packages/shared-contracts/src/schemas/scorecard.ts`); shared statistics
   (`packages/reporting/src/stats.ts`, Newcombe's interval for a difference of rates).
1. **Supply chain.** CycloneDX and SPDX inventory, VEX, licence policy, SLSA provenance bound
   to the artifact and to a trusted signer identity (`apps/api/src/services/supply-chain-service.ts`).
2. **Deeper testing.** Mutation, axe, diff coverage, failure clusters, flake cost
   (`apps/api/src/services/diff-coverage-service.ts`).
3. **Delivery.** GitHub reads, the leased syncer, the push door, DORA and flow, the opt-in
   webhook (`apps/api/src/services/delivery-syncer.ts`, `apps/api/src/services/github-webhook.ts`).
4. **AI-written code.** Attribution, outcomes and the governance gate
   (`apps/api/src/services/ai-code-service.ts`).
5. **Agents.** Eval ingestion and the regression gate, OTLP GenAI traces, runtime budgets,
   chat self-instrumentation, the agent-config scanner, the eval runner
   (`apps/api/src/routes/agent-quality.ts`).
6. **Mocks made real.** Issues from findings and clusters, test proposals, vault rotation,
   shared sessions (`apps/api/src/services/issue-tracker-service.ts`).
7. **Together.** Scorecard endpoints, the digest, the portfolio heatmap, the read-only MCP
   server (`apps/api/src/routes/mcp.ts`), the upload CLI (`tools/automate-cli/src/commands.ts`)
   and the composite action.

## Review

A behavioural review of the whole change found five blockers and nine should-fix issues; all
were fixed test-first and recorded as ledger rows W7-5 to W7-24. Two limitations stay as debt:
W7-22 (repeated eval attempts are pooled in the overall rate) and W7-23 (vault rotation covers
the installation's own workspace).

## Not done

- `auth.service-credentials` stays `mock`: runner identities are still process memory.
- No GitLab or Bitbucket sync; those projects use the push door.
- The Rekor transparency log is not checked.
