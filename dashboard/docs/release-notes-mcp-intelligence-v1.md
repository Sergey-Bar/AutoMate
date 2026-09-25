# Release Notes — MCP + Intelligence Features v1

## Summary

This release introduces MCP interoperability and first-wave intelligence capabilities behind feature flags.

### New Features

- **MCP Server (Dashboard)**
  - Read-only MCP v1 server over Streamable HTTP
  - 7 contract-pinned tools
- **MCP Client Connector (Platform → Dashboard bridge)**
  - Contract-aware connector for Dashboard MCP tool access
- **Failure Taxonomy**
  - Deterministic rule-based failure classifier
- **Predictive Test Selection**
  - Weighted scoring for candidate test prioritization
- **Role-Tailored Analytics**
  - QA/dev/manager-oriented analytics presets
- **Locator Intelligence**
  - Selector stability suggestions for improved test resilience

## Feature Flags (Default: OFF)

### Dashboard

- `FEATURE_MCP_SERVER`
- `FEATURE_FAILURE_TAXONOMY`
- `FEATURE_PREDICTIVE_TEST_SELECTION`
- `FEATURE_ROLE_BASED_VIEWS`
- `FEATURE_LOCATOR_INTELLIGENCE`

### Platform

- `FEATURE_MCP_CLIENT`

## Breaking Changes

**NONE**

## Known Limitations

- MCP v1 is **read-only** only.
- No write/mutation MCP tools in this release.
- No LLM-based classifiers; taxonomy remains deterministic/rule-driven.

## Upgrade Path

1. Deploy Dashboard and Platform binaries as usual.
2. Keep all flags OFF initially (safe default).
3. Enable flags progressively per environment.
4. Validate expected behavior/metrics after each flag enablement.

No migration needed for upgrade enablement.
