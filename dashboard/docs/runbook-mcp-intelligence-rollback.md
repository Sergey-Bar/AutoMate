# MCP + Intelligence Features — Rollback Runbook

## Scope

This runbook rolls back MCP + intelligence rollout behavior using feature flags only.

All flags default to **OFF**. No code rollback needed — just env vars.

## Feature Flags and Ownership

### Dashboard (`Automate`)

| Feature flag | Env var | Controls |
| --- | --- | --- |
| `mcp-server` | `FEATURE_MCP_SERVER` | MCP `/mcp` endpoint and MCP session lifecycle |
| `failure-taxonomy` | `FEATURE_FAILURE_TAXONOMY` | Deterministic failure taxonomy classifier |
| `predictive-test-selection` | `FEATURE_PREDICTIVE_TEST_SELECTION` | Predictive test selection scoring |
| `role-based-views` | `FEATURE_ROLE_BASED_VIEWS` | Role-tailored analytics presets |
| `locator-intelligence` | `FEATURE_LOCATOR_INTELLIGENCE` | Locator stability suggestion engine |

### Platform (`Automate`)

| Feature flag | Env var | Controls |
| --- | --- | --- |
| `mcp-client` | `FEATURE_MCP_CLIENT` | Platform MCP connector (Platform → Dashboard) |

## Step-by-Step Rollback Procedure

1. Set `FEATURE_MCP_SERVER=false` → disables MCP endpoint.
2. Set `FEATURE_FAILURE_TAXONOMY=false` → disables taxonomy classifier.
3. Set `FEATURE_PREDICTIVE_TEST_SELECTION=false` → disables predictive test selection.
4. Set `FEATURE_ROLE_BASED_VIEWS=false` → disables analytics presets.
5. Set `FEATURE_LOCATOR_INTELLIGENCE=false` → disables locator engine.
6. On Platform: set `FEATURE_MCP_CLIENT=false` → disables MCP connector.

Apply env changes through your normal deployment mechanism (secrets manager, runtime env, deployment config) and restart/redeploy services if required by your environment.

## Database Migration Note

Tables added by Task 3 (`failureTaxonomy`, `predictiveCorrelations`) are additive. No data migration required for rollback.

## Post-Rollback Monitoring Checklist

- [ ] Dashboard `/mcp` returns feature-disabled behavior (or is unreachable by policy) when `FEATURE_MCP_SERVER=false`.
- [ ] Platform connector calls stop when `FEATURE_MCP_CLIENT=false`.
- [ ] No new taxonomy classifications are written after `FEATURE_FAILURE_TAXONOMY=false`.
- [ ] Predictive selection responses revert to non-predictive baseline behavior.
- [ ] Role-tailored analytics presets are hidden/disabled.
- [ ] Locator intelligence suggestions are not generated.
- [ ] Error rate and latency return to pre-rollout baseline.
- [ ] Logs contain expected feature-disabled events without auth/policy regressions.

## Rollback Exit Criteria

Rollback is complete when:

- all six flags are confirmed `false` in runtime configuration,
- monitoring checklist items are green,
- and no MCP/intelligence-only paths are active in production traffic.
