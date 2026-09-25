---
title: CI Gate Integration
description: Integrate quality gate enforcement into any CI/CD pipeline using the Automate REST API.
---

# CI Quality Gate Integration

Automate provides a CI-agnostic REST API for quality gate enforcement. Any CI system that can run `curl` can check whether a test run passed the configured quality gate threshold.

---

## How It Works

1. **Run your Playwright tests** with the Automate reporter — results stream in real-time.
2. **Wait for gate evaluation** — call the `POST /api/ci/gate/wait/:runId` endpoint which blocks until the run completes.
3. **Check the `exitCode`** — `0` means the gate passed, `1` means it failed. Fail your CI job accordingly.

---

## API Reference

### `GET /api/ci/gate/:runId`

Returns the current gate status for a completed run. Does not block.

```json
{
  "runId": "abc123",
  "passed": true,
  "gateStatus": "passed",
  "passRate": 97.5,
  "threshold": 95,
  "failedTests": 3,
  "totalTests": 120,
  "quarantinedTests": 2,
  "exitCode": 0
}
```

| Field | Description |
|---|---|
| `passed` | `true` if the gate threshold was met |
| `gateStatus` | `"passed"`, `"failed"`, or `"skipped"` (no gate configured) |
| `passRate` | Percentage of tests that passed |
| `threshold` | The configured pass-rate threshold |
| `exitCode` | `0` = pass, `1` = fail — use this as your CI exit code |

### `POST /api/ci/gate/wait/:runId`

Blocks until the run completes, then returns the gate status. Accepts a `timeout` query parameter (seconds, max 600).

```bash
# Wait up to 10 minutes for run to complete
curl -X POST "http://localhost:4000/api/ci/gate/wait/abc123?timeout=600" \
  -H "Authorization: Bearer $AUTOMATE_DASHBOARD_API_KEY"
```

Returns `408 Request Timeout` if the run doesn't complete within the timeout.

### `GET /api/ci/gate/latest`

Returns the gate status for the most recent run, optionally filtered by workspace and branch.

```bash
# Most recent run on main branch in workspace "production"
curl "http://localhost:4000/api/ci/gate/latest?workspace=production&branch=main" \
  -H "Authorization: Bearer $AUTOMATE_DASHBOARD_API_KEY"
```

---

## Authentication

All gate endpoints require an API key unless `GATE_PUBLIC=true` is set on the server. For public CI pipelines without a secret, set `GATE_PUBLIC=true` in your Dashboard environment.

```bash
# With API key (recommended for private deployments)
curl -H "Authorization: Bearer $AUTOMATE_DASHBOARD_API_KEY" \
  "http://localhost:4000/api/ci/gate/latest?branch=main"

# With GATE_PUBLIC=true (no auth required)
curl "http://localhost:4000/api/ci/gate/latest?branch=main"
```

---

## Portable Shell Script

Use `scripts/check-gate.sh` for a simple, portable gate check that works with any CI system:

```bash
bash scripts/check-gate.sh \
  --url http://your-dashboard.example.com \
  --run-id abc123 \
  --api-key $AUTOMATE_DASHBOARD_API_KEY

# Exit code 0 = gate passed, 1 = gate failed
```

Or with a `wait` (blocks until run completes):

```bash
bash scripts/check-gate.sh \
  --url http://your-dashboard.example.com \
  --run-id abc123 \
  --api-key $AUTOMATE_DASHBOARD_API_KEY \
  --wait \
  --timeout 300
```

---

## GitHub Actions

See `.github/workflows/example-gate.yml` in the repo root for a complete example.

**Key steps:**

```yaml
- name: Run Playwright tests
  run: npx playwright test
  env:
    AUTOMATE_DASHBOARD_URL: ws://${{ env.DASHBOARD_HOST }}:4001
    AUTOMATE_DASHBOARD_API_KEY: ${{ secrets.AUTOMATE_DASHBOARD_API_KEY }}

- name: Wait for quality gate
  run: |
    EXIT_CODE=$(bash scripts/check-gate.sh \
      --url http://${{ env.DASHBOARD_HOST }}:4000 \
      --run-id $RUN_ID \
      --api-key ${{ secrets.AUTOMATE_DASHBOARD_API_KEY }} \
      --wait --timeout 300)
    exit $EXIT_CODE
```

---

## GitLab CI

See `.gitlab-ci.example.yml` in the repo root for a complete example.

---

## Jenkins

See `Jenkinsfile.example` in the repo root for a complete declarative pipeline example.

---

## Azure DevOps

See `azure-pipelines.example.yml` in the repo root for a complete pipeline example.

---

## CircleCI

See `.circleci/config.example.yml` in the repo root for a complete workflow example.

---

## Quality Gate Configuration

Configure the pass-rate threshold in the Dashboard UI under **Settings → Quality Gate**, or via the API:

```bash
curl -X PUT "http://localhost:4000/api/gate-config" \
  -H "Authorization: Bearer $AUTOMATE_DASHBOARD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"passRateThreshold": 95}'
```

The threshold defaults to 100% if no configuration exists. Per-workspace thresholds are supported for multi-project setups.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `404 Run not found` | The run ID doesn't exist. Check the reporter output for the correct ID. |
| `408 Timeout` | The run didn't complete within the timeout. Increase `--timeout` or check the reporter connection. |
| `gateStatus: "skipped"` | No quality gate has been configured. Set a threshold in Settings → Quality Gate. |
| `401 Unauthorized` | Set `--api-key` or enable `GATE_PUBLIC=true` on the server. |
