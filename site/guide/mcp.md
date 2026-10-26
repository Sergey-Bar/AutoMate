# Ask your editor about quality (MCP)

AutoMate serves a read-only [Model Context Protocol](https://modelcontextprotocol.io) server, so
an assistant in your editor can answer "what is limiting this repository's grade?", "does this
branch pass the gate?" or "which tests are flaky?" from the same numbers the dashboard shows.

Every tool reads. None of them writes, triages, starts a scan or spends the model budget.

## The tools

| Tool                     | What it answers                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `list_projects`          | The projects the token can read, each with its grade and weakest dimension. Start here for an id.   |
| `get_health`             | One project's grade on a branch: score, letter, what limits it, all twelve dimensions, what to fix. |
| `list_findings`          | Findings on a branch, most severe first, filtered by dimension, severity, state, tool or text.      |
| `get_gate`               | Whether a branch passes the pull-request gate, every reason, and what it adds over the default.     |
| `get_delivery`           | DORA and pull-request flow over a window.                                                           |
| `get_agent_quality`      | Eval suites against the default branch, and agent runtime (cost, tokens, tool failures).            |
| `get_ai_code`            | How much merged change an AI wrote, and whether it fares worse. Never names a person.               |
| `get_supply_chain`       | SLSA level, licence violations, fixable criticals, vulnerable components, VEX coverage, SBOM age.   |
| `get_test_effectiveness` | Mutation score, diff coverage of the latest commits, flaky tests and their cost, failure causes.    |

Each answer is two text blocks: a one-line summary, and the full contract as JSON — the same
shape the matching API route returns. A refusal is a tool error that starts with the stable
error code, such as `NOT_FOUND: No project …` or `FORBIDDEN: This token is pinned to another project`.

## The token

Create an access token with the **viewer** role on the Access page. It is the only credential the
server takes, and it reads exactly what a viewer can read in the dashboard:

- **Only its own workspace.** A token from another install's workspace does not authenticate, and
  another workspace's project is "no such project".
- **Never an uploader token.** The `uploader` role sends CI reports and reads nothing, so the
  server refuses it as every read route does.
- **Read-only, always.** An operator or admin token works too, and still cannot write through MCP.

Treat it as a secret: put it in your editor's environment or secret store, not in a file you commit.

## Two ways to connect

**Over HTTP**, for an editor that speaks Streamable HTTP and can send a header. The endpoint is
`/api/v1/mcp` on your install, with `Authorization: Bearer <token>`. It is stateless and answers
JSON; a `GET` answers 405, because the server pushes nothing.

**Over stdio**, for an editor that launches a command. The proxy is built with the API, at
`apps/api/dist/mcp/stdio.js` in a checkout of this repository, and forwards every request to the
HTTP endpoint unchanged. It reads two variables:

- `AUTOMATE_URL` — your install's origin. `https://` anywhere; `http://` only to a loopback host
  (`localhost`, `127.0.0.0/8` or `::1`), because the token would otherwise cross the network in the clear. The proxy
  refuses anything else before it sends a byte.
- `AUTOMATE_TOKEN` — the viewer token.

The proxy writes the protocol to stdout and its own errors to stderr, and never prints the token.

## Editor configuration

Replace the path, the origin and the token. Each block is the whole file for that editor, or the
one entry to add to it.

### Claude Code

```bash
claude mcp add automate --env AUTOMATE_URL=https://automate.example.com \
  --env AUTOMATE_TOKEN=amt_your_viewer_token -- node /path/to/AutoMate/apps/api/dist/mcp/stdio.js
```

Or, over HTTP:

```bash
claude mcp add --transport http automate https://automate.example.com/api/v1/mcp \
  --header "Authorization: Bearer amt_your_viewer_token"
```

### Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "automate": {
      "command": "node",
      "args": ["/path/to/AutoMate/apps/api/dist/mcp/stdio.js"],
      "env": {
        "AUTOMATE_URL": "https://automate.example.com",
        "AUTOMATE_TOKEN": "amt_your_viewer_token"
      }
    }
  }
}
```

### Kiro — `.kiro/settings/mcp.json`

```json
{
  "mcpServers": {
    "automate": {
      "command": "node",
      "args": ["/path/to/AutoMate/apps/api/dist/mcp/stdio.js"],
      "env": {
        "AUTOMATE_URL": "https://automate.example.com",
        "AUTOMATE_TOKEN": "amt_your_viewer_token"
      },
      "disabled": false,
      "autoApprove": ["list_projects", "get_health"]
    }
  }
}
```

### VS Code — `.vscode/mcp.json`

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "automate-token",
      "description": "AutoMate viewer token",
      "password": true
    }
  ],
  "servers": {
    "automate": {
      "type": "http",
      "url": "https://automate.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer ${input:automate-token}" }
    }
  }
}
```

VS Code prompts for the token once and keeps it in its secret storage, which is why this one uses
the HTTP endpoint rather than an `env` block in a file you might commit.

**An agent-config scan will notice a token in a committed MCP file.** AutoMate's own agent-config
scan reads `.cursor/mcp.json`, `.kiro/settings/mcp.json` and `.vscode/mcp.json`, and a credential
in `args` or a literal in `env` is a finding — keep the real token in your user-level config.

## What it does not do

No resources, prompts or server-initiated notifications; no sessions; no OAuth discovery (the
token is the credential); no tool that writes. The capability register's `connectors.mcp` row is
the authority on what is built.
