---
title: Sending results
description: Get a Playwright, JUnit, k6 or ZAP report into Automate from any CI job.
outline: deep
---

# Sending results

Your tests already create a report. Send that file to Automate and inspect the result
alongside its original evidence.

<GuideStoryboard kind="upload" />

## The upload

`POST /api/v1/reporter/upload` takes a multipart form with one `file` part and a few
optional fields. When the API has `REPORTER_SECRET` set, send it as a bearer token.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $REPORTER_SECRET" \
  -F file=@results.json \
  -F format=playwright \
  -F runId="$CI_PIPELINE_ID" \
  -F branch="$CI_COMMIT_BRANCH" \
  -F commitSha="$CI_COMMIT_SHA" \
  http://127.0.0.1:3000/api/v1/reporter/upload
```

::: details See every upload field

| Field                     | Purpose                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `file`                    | The report. Exactly one file part.                                                                                                   |
| `format`                  | Which adapter reads it: `playwright`, `junit`, `k6` or `zap`. See below for what happens when you omit it.                           |
| `runId`                   | Your identity for the run. Omit it and the report's own SHA-256 becomes the id, so a re-upload is a replay rather than a second run. |
| `branch`                  | Shown on the run and used to filter trends.                                                                                          |
| `commitSha`               | The commit under test.                                                                                                               |
| `environment`             | Free text, such as `staging`.                                                                                                        |
| `startedAt`, `finishedAt` | ISO 8601 timestamps with seconds, when the report does not carry them.                                                               |

:::

**Declare the format.** The declared format wins; without it the file name decides, and
the content only decides when neither does. A JUnit file sent as `format=playwright` is
refused with a message saying which format the bytes look like, rather than being parsed
into nonsense.

**Errors name the problem.** A report the adapter cannot read answers
`INVALID_REPORTER_UPLOAD` with the adapter's own reason in `details.adapterMessage` — for
example that a JUnit document contains no test cases — so the fix is in the response.

## Playwright

Ask Playwright for its JSON reporter, then upload the file:

```bash
npx playwright test --reporter=json > results.json
```

Retries are read from each test's `results[]` history. A test that failed and then passed
on a retry is stored as `flaky`, not as a pass.

## JUnit XML

Almost every runner can write JUnit XML: pytest (`--junitxml=junit.xml`), Maven Surefire,
Gradle, Jest with `jest-junit`, Go with `gotestsum --junitfile`, and more.

```bash
curl -H "Authorization: Bearer $REPORTER_SECRET" \
  -F file=@junit.xml -F format=junit \
  http://127.0.0.1:3000/api/v1/reporter/upload
```

The parser does not expand external entities, caps failure messages, and treats a
truncated or malformed document as a run of `unknown` status — never as a pass.

## k6 and OWASP ZAP

The same request with `format=k6` (a k6 summary JSON) or `format=zap` (a ZAP XML report).
Each declared k6 threshold becomes a result, evaluated against the metric it names, so a
script that blew its latency budget fails even when every request succeeded. Each ZAP
alert becomes a result: Informational is `skipped`, Low to High is `failed`, and a risk
code this build does not recognise is `unknown` rather than clean.

## In CI

A GitHub Actions step, run even when the tests failed:

```yaml
- name: Upload results to Automate
  if: always()
  run: |
    curl --fail-with-body \
      -H "Authorization: Bearer ${{ secrets.AUTOMATE_REPORTER_SECRET }}" \
      -F file=@results.json -F format=playwright \
      -F runId="${{ github.run_id }}-${{ github.run_attempt }}" \
      -F branch="${{ github.ref_name }}" -F commitSha="${{ github.sha }}" \
      "${{ vars.AUTOMATE_URL }}/api/v1/reporter/upload"
```

`if: always()` matters: the run you most need to see is the one that failed.

## Live events instead of a file

A reporter that streams while the suite runs can post events to
`POST /api/v1/reporter/events` — `run:start`, `test:begin`, `test:end`, `run:end` — and
the dashboard updates over server-sent events as they arrive. The event contracts are in
`packages/shared-contracts/src/schemas/reporter-events.ts`, and the full route list is in
[`docs/openapi.json`](https://github.com/Sergey-Bar/AutoMate/blob/main/docs/openapi.json).
