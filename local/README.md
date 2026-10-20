# AUTOMATE (local)

A local-first tool that finds the testing setup of a repository on this computer, reads the
test reports it already has, shows what they do and do not say, and (with explicit consent)
runs a command and reads what it wrote. Dependency-free Node (ESM with JSDoc types).

This is **not** a pnpm workspace package, and the repository's gates (lint, format,
typecheck, coverage, duplication, complexity, security scans) were not run on it. The design
is in [`docs/local/`](../docs/local/README.md); what is built, how it departs from that design
and what could not be verified is in
[`docs/local/implementation-status.md`](../docs/local/implementation-status.md). Read that
before relying on anything here.

## Run it

```text
node local/bin/automate-local.mjs serve
node local/bin/automate-local.mjs scan <folder>
node local/bin/automate-local.mjs diagnostics
```

`serve` prints an address with a one-time token after the `#`. It listens on the loopback
interface only. **Execution is not isolated:** a command you approve runs as you, with your
permissions.

## Test it

Each test file runs on its own:

```text
node local/test/runner.test.mjs
```

Running them through `node --test` hangs in some sandboxes when children are spawned with
piped output, so they are run directly.

## Layout

| Path       | Contents                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/`     | The launcher.                                                                                                                             |
| `src/`     | Readers, store, reconciliation, scanner, analysis, engine, interface, runner, toolbox, findings, AI interface, Cobertura and ZIP readers. |
| `catalog/` | The tool catalog, as data.                                                                                                                |
| `corpus/`  | Fixtures with provenance, and hand-written goldens.                                                                                       |
| `test/`    | Tests and the commands they run.                                                                                                          |

## Rules this code follows

- No dependencies; no network use; nothing written outside the data directory and, for a
  run you approve, the repository you chose.
- A metric that cannot be computed is null with a reason, never zero.
- Every finding and recommendation carries its evidence; a claim without evidence is not shown.
- Every fixture has provenance, and every golden was written by hand from the format and not
  produced by the code under test.
