# MVP vs Post-MVP Features

This page defines the feature tiers used for the MVP, roadmap decisions, release notes, and support expectations.

## MVP Features

The MVP is the first user-facing release target. It is not a claim that every implemented repository feature is absent; it defines what the default install should expose and what the team supports as the primary product promise.

MVP features are part of the default product promise: connect Playwright, stream a run, inspect failures, and gate CI. They should remain stable across releases.

Criteria:
- Enabled by default.
- Covered by regression tests.
- Included in release validation.
- Backward compatibility expected unless explicitly announced.

Current MVP set:
- Live monitoring (runs/tests real-time flow)
- Run details and artifact viewers (screenshots, videos, traces, timing details)
- Analytics essentials (pass rate, duration trends, recent run health)
- Test explorer (search and filters)
- Quality gate (pass-rate threshold for CI)
- Auth/session baseline
- English/Hebrew UI with RTL support

## Post-MVP Features

Post-MVP features are valuable but are not part of the MVP promise. They stay opt-in until their UX, API shape, and operational behavior are validated with design partners.

Criteria:
- Gated by feature flags and disabled by default.
- Can change faster between minor releases.
- Requires explicit quality tracking before graduating to MVP/Core.

Typical examples in this tier:
- AI explain variants/provider-specific behavior
- NL query and ranking heuristics
- Auto-quarantine tuning/threshold behavior
- Terminal runner/codegen workflows
- Run comparison and PR comparison
- Slack/Jira/GitHub integrations
- Baseline management and visual diff workflows
- Error clustering and known-failure tracking
- MCP, RBAC, SSO, enterprise gates, ROI metrics, and AI test generation

## Graduation Rules (Post-MVP → MVP/Core)

A feature graduates to Core when all conditions are met:
- Stable behavior across at least two design-partner deployments or releases.
- Sufficient automated coverage at relevant levels.
- No unresolved high-severity issues in current milestone.
- Documentation complete in README/docs-site.
- Operational guidance exists (env vars, limits, fallback behavior).
- The feature improves the primary MVP flow rather than creating a second product surface.

## Why This Split Exists

The split protects delivery quality: the MVP remains predictable for users, while post-MVP capabilities remain fast to iterate.
