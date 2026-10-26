---
title: Agent quality
description: How AutoMate stores eval runs and gates pull requests on regressions, receives OpenTelemetry GenAI traces, budgets agent runtime, scans agent configuration and MCP servers, and runs evals of its own.
outline: deep
---

# Agent quality

Five things, each opt-in, each feeding the `agent-quality` dimension of the
[health grade](repository-health.md) only when the policy gives that dimension a weight:

- **Evals** — runs of promptfoo, DeepEval, Inspect or Automate's own runner, stored per suite and
  compared against the default branch.
- **Traces** — OpenTelemetry GenAI spans, sent by your agents over OTLP/HTTP JSON.
- **Runtime** — cost, tokens, latency, errors and tool failures per agent, against budgets you
  set.
- **Agent configuration** — your `AGENTS.md`, rules files, skills and MCP configs, scanned as
  supply-chain input, with an inventory of the MCP servers they launch.
- **The built-in eval runner** — datasets with deterministic checks, run through the
  installation's own model gateway.

**Content is not stored by default.** An eval case keeps the sha256 of its prompt, not the
prompt; a span keeps its model, tokens, timing and status, not the messages. Both can be turned
on per project, and both say what that costs below.

## The policy

Everything here is configured in the `health.agents` block of `automate.config.json`:

```json
{
  "health": {
    "weights": { "agent-quality": 10 },
    "agents": {
      "storePrompts": false,
      "maxEvalRegression": 0.05,
      "minEvalAttempts": 10,
      "gateOnEvals": true,
      "gateOnRuntime": false,
      "storeTraceContent": false,
      "traceRetentionDays": 14,
      "prices": [
        {
          "provider": "openai",
          "model": "gpt-4o",
          "inputPerMillionUsd": 2.5,
          "outputPerMillionUsd": 10
        }
      ],
      "budgets": {
        "maxCostPerRunUsd": 0.1,
        "maxTokensPerRun": 50000,
        "maxToolFailureRate": 0.1,
        "maxP95LatencyMs": 30000,
        "maxErrorRate": 0.05
      }
    }
  }
}
```

| Field                | Default | What it does                                                                                      |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `storePrompts`       | `false` | Keep each eval case's prompt text, up to 20 000 characters. Its sha256 is kept either way         |
| `maxEvalRegression`  | `0`     | The drop in a suite's overall pass rate, 0–1, that is still a pass                                |
| `minEvalAttempts`    | `10`    | Decided attempts each side needs on shared cases before a comparison may pass                     |
| `gateOnEvals`        | `false` | Any eval suite that is not a pass fails the pull-request gate                                     |
| `gateOnRuntime`      | `false` | A runtime budget breach, or an unmeasured runtime, fails the pull-request gate                    |
| `storeTraceContent`  | `false` | Keep span prompt and completion content, redacted and capped at 8 KB per side                     |
| `traceRetentionDays` | `14`    | How long spans are kept, 1–90                                                                     |
| `prices`             | none    | Per-model prices an administrator sets. **None is built in**: an unpriced span is unknown cost    |
| `budgets`            | none    | Per-agent limits. Each is checked per agent, so one expensive agent cannot hide behind cheap ones |

Prices and budgets live in the policy because the policy is versioned with the code it
describes; a changed price is a reviewed change, not a setting someone flipped.

## Evals

### Uploading a run

Eval reports go through **the** health upload door — the same token, the same body limit, the
same action — as one of four formats:

| Format               | Written by                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `promptfoo-json`     | `promptfoo eval -o results.json` (output file versions 2 and 3; cases are `results.results`) |
| `deepeval-json`      | A saved DeepEval `TestRun` (`testCases`, and conversational test cases)                      |
| `inspect-eval-json`  | An Inspect AI eval log in JSON (`inspect eval … --log-format=json`; cases are `samples`)     |
| `automate-eval-json` | Automate's own run shape: what the built-in runner writes, and what any script may write     |

With the repository's action:

```yaml
- run: npx promptfoo@0.120.1 eval --config promptfooconfig.yaml --output promptfoo.json
- uses: Sergey-Bar/AutoMate/.github/actions/automate-health@main
  with:
    url: https://automate.example.com
    project-id: ${{ vars.AUTOMATE_PROJECT_ID }}
    token: ${{ secrets.AUTOMATE_UPLOAD_TOKEN }}
    reports: |
      promptfoo-json:promptfoo.json
```

Or directly — the other two tools the same way:

```bash
curl --fail-with-body -H "Authorization: Bearer $AUTOMATE_UPLOAD_TOKEN" \
  --data-binary @deepeval.json \
  "$AUTOMATE_URL/api/v1/projects/$PROJECT/health/reports?format=deepeval-json&branch=$BRANCH&commit=$SHA"

inspect eval task.py --log-format=json --log-dir logs
curl --fail-with-body -H "Authorization: Bearer $AUTOMATE_UPLOAD_TOKEN" \
  --data-binary @"$(ls -t logs/*.json | head -n 1)" \
  "$AUTOMATE_URL/api/v1/projects/$PROJECT/health/reports?format=inspect-eval-json&branch=$BRANCH&commit=$SHA"
```

How a tool's verdict is read: promptfoo's and DeepEval's `success` as written; Inspect has no
per-sample verdict, so `C`, `yes` and `true` scores pass and `I`, `P`, `N`, `no` and `false`
fail. An attempt that errored is undecided, never failed — a rate limit is not a wrong answer.

Each suite is its own report kind (`<format>:<suite>`), so uploading one suite never
supersedes another's numbers. A stored run keeps at most 5000 cases and 100 attempts per case,
and says `truncated` when either was cut; a project keeps its 500 newest runs.

### How a regression is decided

The newest run of each suite on a branch is compared with the newest run of the **same suite on
the default branch**:

- **Like for like.** Pass rates are compared over the cases both runs share. A new case is
  listed, never mixed into the overall rate — otherwise deleting the hard cases would read as an
  improvement.
- **Per case: Newcombe.** A case regresses _significantly_ only when Newcombe's interval for the
  difference of its two pass rates excludes zero. 9/10 → 8/10 is noise; 9/10 → 3/10 is a
  regression.
- **Overall:** the suite fails when the whole interval for the change in its pass rate sits
  below `−maxEvalRegression`. Known limitation: repeats of one case are pooled as independent
  trials in that overall rate, which overstates its significance when a case's repeats agree
  with each other; the per-case comparison does not pool.
- **Metric scores: a seeded bootstrap.** A named score (faithfulness, relevance, …) changes
  significantly when the bootstrap interval for the difference of means excludes zero. The seed
  is derived from the two run ids, so the same two runs give the same answer on every host and
  every read.
- **Flaky is disagreement.** A case is flaky when its decided attempts disagree — the same rule
  as flaky tests. A case that fails every attempt is broken, not flaky. Flaky cases are listed
  and never fail the gate on their own.
- **Too few attempts is not a pass.** Fewer than `minEvalAttempts` decided attempts on either
  side is `insufficient`: shown, never a pass, never a fail. A suite with no run on the default
  branch has no comparison at all.

With `gateOnEvals`, **only a pass passes**: a `fail` fails the pull-request gate with reasons such
as `Evals (support-bot): …`, and so does every suite the gate could not show is safe — an
`insufficient` comparison, a suite with no baseline run on the default branch, a suite the default
branch runs and the branch did not, and a branch where no eval ran at all. When the gate names a
commit, each suite is judged on its run for that commit; a suite with none falls back to the
branch's latest run, and the comment says so. The default branch is the baseline and is not
compared against itself. Gated or not, the GitHub comment carries an **Evals** section: each
suite's verdict, its significant regressions and its flaky cases.

| Route                                        | Role   | Returns                                                                 |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `GET /api/v1/projects/:id/evals?branch=`     | viewer | Each suite's newest run, its baseline, the comparison and the scorecard |
| `GET /api/v1/projects/:id/evals/runs/:runId` | viewer | One run with its cases and every attempt                                |

## Traces

Point any OpenTelemetry exporter at the project's receiver. **JSON only**: a protobuf export is
refused with `415 UNSUPPORTED_MEDIA_TYPE`, so set the protocol explicitly:

```bash
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://automate.example.com/api/v1/projects/$PROJECT/otlp/v1/traces"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Bearer%20$AUTOMATE_UPLOAD_TOKEN"
# optional: export OTEL_EXPORTER_OTLP_TRACES_COMPRESSION=gzip
```

The receiver takes the same credential as an upload — an uploader token pinned to the project,
an operator's or admin's token, or the reporter secret — and **it is never open**: on an install with no
`REPORTER_SECRET` it answers `503 NOT_CONFIGURED` to anything but a token. A body is at most
8 MiB after decompression and at most 10 000 spans.

Spans are read against the GenAI semantic conventions (1.44.0). The answer follows OTLP:

```json
{
  "partialSuccess": {
    "rejectedSpans": 3,
    "errorMessage": "3 span(s) carry no gen_ai attributes and are not stored"
  }
}
```

Every span not stored is counted as rejected and says why: it carries no `gen_ai` attributes
(your HTTP and database spans), it is over the request limit, or it started before the
retention window. A span sent twice is stored once and is not a rejection.

**Retention.** Each span is written with the instant it expires (`traceRetentionDays`, default
14, at most 90), and expired spans are deleted on every write and by an hourly sweep.

**Content.** Only with `storeTraceContent`. It is then passed through the product's secret
redactor (`packages/reporter/src/redact.ts` — bearer tokens, JWTs, AWS keys, GitHub tokens,
`sk-` keys, private-key blocks, `password=`-style assignments) and capped at 8 KB per side.
Pattern redaction is best effort; that is why it is off by default.

## Runtime

`GET /api/v1/projects/:id/agents/runtime?days=7` (viewer, 1–90 days) reads the window and the
one before it:

- **runs** — an `invoke_agent` span and everything beneath it; a trace with none is one run;
- **cost** — priced from `prices` only; a span with no matching price is counted as unknown
  cost, never estimated, so a missing price reads as a gap rather than a saving;
- **tokens, p50/p95 latency, error rate, tool-call failure rate**, the top failing tool, mean
  trajectory length, and **loops** — the same tool called with the same arguments three or more
  times in a row;
- per agent and per model, with the change against the previous window.

The **runtime scorecard** checks `budgets` per agent and fails on any breach, naming the agent.
Its 7-day score joins `agent-quality` as the `agent-runtime` metric, beside each eval suite's
metrics (`eval-pass-rate`, and each named score on a 0–1 scale). The dimension combines them
the way every dimension combines its components — an equally weighted geometric mean — so a
low eval pass rate cannot be averaged away by a cheap runtime, nor the other way round. Evals
say "does it answer correctly"; runtime says "does it run within budget". With `gateOnRuntime`,
a breach fails the pull-request gate (`Agent runtime: …`), and so does an `insufficient` or
`not_configured` scorecard (`Agent runtime was not measured …`): an unmeasured budget is not one
that was met. Fewer than 10 runs with nothing breached is `insufficient`.

Reads load at most 20 000 spans per window and say `truncated` when there were more.

### AutoMate's own chat

When the installation has a model provider and a database, every chat completion it serves is
recorded as one `chat` span — model, tokens when the provider reported them, duration, and
whether it failed — and never its content. These spans belong to the installation, not to a
project: they are stored under the installation's workspace with no project, as agent
`automate-chat`, kept 14 days, and read at `GET /api/v1/chat/runtime` (viewer). No price is
configured for them, so their cost is reported as unknown.

## Agent configuration and MCP servers

This is the product scanning **your** repository. It is not this repository's own
`pnpm skill-scan` gate, which wraps SkillSpector over AutoMate's own skills.

The scanner reads the files coding agents obey — `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Cursor
and Windsurf rules, Copilot instructions and prompts, Kiro steering, Kilo agents, every
`SKILL.md`, Claude settings, and the MCP configs (`.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`, `.kiro/settings/mcp.json`, `.gemini/settings.json`) — and reports:

| Rule                                 | Finds                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-config/prompt-injection`      | Instruction-override phrases, hidden HTML-comment instructions, invisible or bidirectional control characters, a long base64 blob in prose |
| `agent-config/exfiltration`          | An instruction to send secrets, env or files to a network destination, or to pipe a download into a shell                                  |
| `agent-config/embedded-secret`       | A credential written into an instruction file or an MCP config value, code blocks included                                                 |
| `agent-config/mcp-unpinned`          | An MCP server fetched at launch (`npx`, `pnpm dlx`, `bunx`, `uvx`, `pipx run`, `docker run`) without an exact version or digest            |
| `agent-config/mcp-auto-install`      | An MCP server launched with `npx -y` / `--yes`, which installs without asking                                                              |
| `agent-config/mcp-plaintext-remote`  | A remote MCP server over plain `http://` to a host that is not loopback                                                                    |
| `agent-config/mcp-secret-in-args`    | A credential in an MCP server's command-line args or URL query string                                                                      |
| `agent-config/over-broad-permission` | A setting that approves every tool call (`permissions.allow` of `Bash(*)`, `bypassPermissions`, `autoApprove: ["*"]`, `trust: true`, …)    |
| `agent-config/unparseable`           | A JSON or JSONC config that does not parse — so nothing in it was checked                                                                  |

Code blocks and sentences that quote an example ("for example", "such as") are not read as
instructions; invisible and bidirectional control characters are flagged everywhere.

**Where the files come from.** For a project with a local checkout, **Scan now** runs the
scanner on the server: it walks the checkout without ever following a symbolic link, skips
`.git` and dependency directories, and reads at most 200 matching files of at most 256 KB each.
For a project with no checkout on the server, send the files from CI:

```bash
jq -n --arg branch "$BRANCH" --arg commit "$SHA" \
  --rawfile agents AGENTS.md --rawfile mcp .mcp.json \
  '{branch: $branch, commit: $commit, files: [{path: "AGENTS.md", text: $agents}, {path: ".mcp.json", text: $mcp}]}' |
curl --fail-with-body -H "Authorization: Bearer $AUTOMATE_UPLOAD_TOKEN" -H 'content-type: application/json' \
  --data-binary @- "$AUTOMATE_URL/api/v1/projects/$PROJECT/health/agent-config"
```

A path that is not agent configuration, or that climbs out of the repository, is ignored and
counted. A git-sourced project is not cloned for this scan: send its files from CI.

Findings join the finding lifecycle under the tool `automate-agent-config` — a removed
instruction is **fixed** by the next scan — and the **MCP inventory** of the branch is replaced
by each scan: name, config file, transport, launch command, package, version, whether it is
pinned, URL, and the **names** of the environment variables it is given. Never their values. A
URL is stored and served with its userinfo and fragment removed and every query value replaced
by `REDACTED` (`?api_key=REDACTED`), so a credential the scan flags is not then shown to every
viewer.

The server-side walk never reads `*.local.json` (such as `.claude/settings.local.json`) or
`claude_desktop_config.json`: those are a developer's local, conventionally untracked files, where
tokens get pasted. The API runs no subprocess, so it cannot ask git which files are tracked; it
skips them by name instead. A committed one is still scanned when CI sends it.

| Route                                                 | Role                                                            | Does                              |
| ----------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- |
| `POST /api/v1/projects/:id/health/agent-config`       | uploader credential (reporter secret, uploader token, operator) | Scans the files CI sent           |
| `GET /api/v1/projects/:id/agents/mcp-servers?branch=` | viewer                                                          | The branch's MCP server inventory |

## The built-in eval runner

A dataset is a list of cases, each an input (and an optional system prompt) with checks:

```json
{
  "name": "capitals",
  "model": "llama3.1:8b",
  "repeats": 5,
  "cases": [
    {
      "id": "france",
      "input": "What is the capital of France?",
      "checks": [{ "type": "contains", "value": "paris" }]
    },
    {
      "id": "year",
      "input": "In what year did the Berlin Wall fall? Answer with the year only.",
      "checks": [{ "type": "regex", "pattern": "^\\s*1989\\s*$" }]
    },
    {
      "id": "json",
      "input": "Return the capital of Italy as JSON with a city field.",
      "checks": [{ "type": "json", "required": [{ "key": "city", "type": "string" }] }]
    }
  ]
}
```

| Check      | Passes when                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `contains` | The answer contains `value` — case-insensitive unless `caseSensitive`                           |
| `regex`    | `pattern` (at most 200 characters, flags `imsu`) matches                                        |
| `json`     | The answer — or its first fenced `json` block — is an object with every `required` key and type |

A regex that could backtrack catastrophically — a repeated group that itself contains a
quantifier or an alternation, or a back-reference — is refused when the dataset is saved. Every
match also runs on at most 20 000 characters under a 250 ms timeout, and a match that times out
leaves the attempt undecided rather than passed.

An **LLM judge** runs only when the dataset sets `judge: { "model": …, "rubric": … }`. It is
asked after the checks pass, and the attempt passes only if the judge answers `PASS`.

`POST /api/v1/projects/:id/evals/datasets/:datasetId/run` (operator — it spends the model
budget, like chat) answers `202` and runs every case × repeat through the installation's
gateway, at most 1000 attempts, one dataset run at a time. The run is written in
`automate-eval-json` and stored through the same upload ingestion as CI, so it is graded and
compared exactly like an uploaded promptfoo run. A provider failure is an undecided attempt,
never a pass. With no model provider configured the run is refused with `503 NOT_CONFIGURED`
before anything is stored.

| Route                                                     | Role     | Does                                       |
| --------------------------------------------------------- | -------- | ------------------------------------------ |
| `POST /api/v1/projects/:id/evals/datasets`                | operator | Creates a dataset, or replaces one by name |
| `GET /api/v1/projects/:id/evals/datasets`                 | viewer   | The project's datasets                     |
| `POST /api/v1/projects/:id/evals/datasets/:datasetId/run` | operator | Starts a run in the background             |

Every write here is audited, with counts and never content.

## Where the code is

| What                              | Where                                               |
| --------------------------------- | --------------------------------------------------- |
| Eval adapters and metrics         | `packages/reporter/src/adapters/evals.ts`           |
| The comparison and the scorecard  | `packages/reporting/src/eval-regression.ts`         |
| Eval storage and the gate reading | `apps/api/src/services/eval-service.ts`             |
| The OTLP adapter                  | `packages/reporter/src/adapters/otlp-genai.ts`      |
| The redactor                      | `packages/reporter/src/redact.ts`                   |
| Span storage, retention, runtime  | `apps/api/src/services/genai-span-service.ts`       |
| Runtime analytics and budgets     | `packages/reporting/src/agent-runtime.ts`           |
| Chat self-instrumentation         | `packages/automation/src/instrumented-gateway.ts`   |
| The agent-config rules            | `packages/projects/src/health/agent-config-scan.ts` |
| Collection and the MCP inventory  | `apps/api/src/services/agent-config-service.ts`     |
| The eval runner                   | `apps/api/src/services/eval-runner.ts`              |
| Routes                            | `apps/api/src/routes/agent-quality.ts`              |
