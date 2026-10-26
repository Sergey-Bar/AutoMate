# Send results from any CI (the `automate` CLI)

`tools/automate-cli` is a small Node command, `automate`, with no dependencies of its own. It does
the four things a pipeline needs: upload a scanner report, ask for the pull-request gate, record a
deployment, and send the repository's agent configuration. On GitHub Actions the composite action
in `.github/actions/automate-health` does the same four things, and its inputs are below.

## Configure it

The CLI reads its destination and credential from the environment, so the token never appears in
a command line, a shell history or a process listing:

- `AUTOMATE_URL` — your install's origin. `https://` anywhere; `http://` only to a loopback host
  (`localhost`, `127.0.0.0/8` — also as `::ffff:127.x.x.x` — or `::1`), the same rule as the MCP
  stdio proxy. Anything else is refused before a byte is sent, because the token would cross the
  network in the clear. The composite action's own check is stricter: `localhost`, `::1` or a
  numeric `127.d.d.d`, so a hostname such as `127.evil.example` never passes.
- `AUTOMATE_TOKEN` — an access token. For CI, an **uploader** token pinned to the project: it can
  send reports to that one project and read nothing.
- `AUTOMATE_PROJECT` — the project's id, from its page in the dashboard. `--project <id>` overrides it.

`--branch` and `--commit` default to `AUTOMATE_BRANCH` and `AUTOMATE_COMMIT`, then to GitHub
Actions' own `GITHUB_HEAD_REF`/`GITHUB_REF_NAME` and `GITHUB_SHA`.

Build it from a checkout with the rest of the workspace; the bin is `tools/automate-cli/dist/index.js`.

## Commands

```bash
# A report, in any format the upload door reads (sarif, lcov, cyclonedx-json, stryker-mutation, …)
automate upload --format sarif --file semgrep.sarif
automate upload --format slsa-provenance --file provenance.json --digest sha256:<64 hex>

# The pull-request gate: exits 1 when it fails, printing every reason
automate gate --branch "$BRANCH" --commit "$SHA" --pr 42

# A deployment, through the delivery push door, for the DORA scorecard.
# Also: --id, --url, --created-at, and the switches --rollback, --hotfix, --unplanned
automate deploy --environment production --status success --sha "$SHA"

# AGENTS.md, CLAUDE.md, .cursor/rules, .mcp.json, SKILL.md … under a directory.
# Needs a branch: --branch, AUTOMATE_BRANCH, or GitHub Actions' own
automate agent-config --dir .
```

`upload` also takes `--source-root` (default `GITHUB_WORKSPACE`): the checkout a SARIF scanner ran
in, so the absolute paths it wrote become repository-relative.

A misspelt option is refused rather than ignored: a step that silently dropped `--commit` would
gate the wrong commit.

## Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | Done; for `gate`, the gate passed.                              |
| 1    | The gate failed. Nothing went wrong: the answer was no.         |
| 2    | The command line or the environment is wrong. Nothing was sent. |
| 3    | The server refused the request, or could not be reached.        |
| 4    | The token was refused (401 or 403).                             |

A refusal prints the server's own error code and sentence, never the token.

## The GitHub composite action

```yaml
- uses: your-org/AutoMate/.github/actions/automate-health@<pinned sha>
  with:
    url: https://automate.example.com
    project-id: ${{ vars.AUTOMATE_PROJECT }}
    token: ${{ secrets.AUTOMATE_UPLOADER_TOKEN }}
    reports: |
      sarif:semgrep.sarif
      lcov:coverage/lcov.info
      git-diff:changes.diff
    agent-config: 'true'
    deployment-environment: production
```

| Input                    | Default   | What it does                                                           |
| ------------------------ | --------- | ---------------------------------------------------------------------- |
| `url`                    | required  | The install's origin. Refused unless `https://` or loopback `http://`. |
| `project-id`             | required  | The project's id.                                                      |
| `token`                  | required  | An uploader token for the project.                                     |
| `reports`                | required  | One `format:path` per line. A missing file fails the step.             |
| `codeowners`             | `'true'`  | Send CODEOWNERS so findings get owners.                                |
| `gate`                   | `'true'`  | Ask for the gate, and fail the job when it fails. Output `verdict`.    |
| `agent-config`           | `'false'` | Send the tracked agent instruction and MCP configuration files.        |
| `deployment-environment` | `''`      | Record a deployment of this commit to the named environment.           |
| `deployment-status`      | `success` | `success` or `failure`, for that deployment.                           |

Every input the action had before is unchanged. The token goes to curl through the environment and
a header file, never argv.
