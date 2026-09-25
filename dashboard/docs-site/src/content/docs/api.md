---
title: API Reference
description: Automate REST API endpoints.
---

Automate provides a comprehensive REST API for querying test results, managing configuration, and integrating with external tools.

All API routes are prefixed with `/api` unless otherwise noted. Authentication is required for most endpoints via an API key.

## OpenAPI Documentation

Interactive OpenAPI (Swagger) documentation is available at:

`http://your-dashboard-url/documentation`

## Key Endpoints

### Health Check

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health/live` | GET | Liveness probe (process is running) |
| `/health/ready` | GET | Readiness probe (DB is connected) |
| `/health/startup` | GET | Startup probe (init complete) |

### Test Runs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/runs` | GET | List recent test runs |
| `/api/runs/:id` | GET | Get detailed information for a specific run |
| `/api/runs/:id` | DELETE | Delete a test run and its artifacts |

### Tests and Results

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tests` | GET | Search and filter test cases |
| `/api/tests/:id` | GET | Get history for a specific test |
| `/api/tests/:id/quarantine` | POST | Toggle quarantine status for a test |

### Analytics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics/summary` | GET | High-level pass rate and duration metrics |
| `/api/analytics/trends` | GET | Historical data for pass rates and flakiness |
| `/api/analytics/heatmap` | GET | Failure distribution across projects/folders |

### Settings and Integrations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET/PATCH | Get or update dashboard global settings |
| `/api/integrations` | GET | List configured integration hooks (Slack, Jira, etc.) |
| `/api/integrations/slack` | POST | Update Slack notification settings |

### Artifacts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/artifacts/:path` | GET | Retrieve a specific test artifact (screenshot, video, trace) |

## Reporter Ingestion

The reporter connects via WebSocket to port `4001` (by default) at the `/reporter` path.

`ws://your-dashboard-url:4001/reporter`

Events are sent as JSON strings following the `shared` package schema.
