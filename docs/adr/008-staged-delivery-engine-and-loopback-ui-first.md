# ADR-008: Staged delivery — local engine and loopback UI first, desktop shell later

**Status:** proposed
**Date:** 2026-10-19
**Supersedes:** —

## Context

AUTOMATE (local) needs a user interface, a local engine that scans and ingests, and
eventually a way to run test commands. A desktop shell (Tauri or Electron) gives a native
install and window, but it adds packaging, code signing and updater work, and it ties the
engine to one process model before the engine has been proven.

The capability register records an earlier Tauri desktop application as `obsolete`, so
this repository has already paid for one desktop shell that was not kept. The lesson taken
here is about ordering: the risk in this product is in the engine (report normalisation,
duplicate-run handling, evidence preservation, process control), not in the window around
it.

## Decision

Deliver in stages:

1. **Engine plus UI behind a typed local API.** The engine is a Node process that exposes a
   typed HTTP interface with server-sent events on the loopback interface only. The React
   UI is served by it. A CLI launches both.
2. **Desktop shell later**, after the engine, its security properties and its cross-platform
   behaviour have been shown to hold. The shell wraps the same engine and UI.

**Tauri versus Electron is not decided here.** A prototype with explicit criteria decides it
(packaging size, how a Node engine is embedded, updater and signing cost, process
supervision, accessibility behaviour). The criteria are listed in
`docs/local/architecture.md` when that document is written.

The local API has these properties as proposals: loopback only, an operating-system
assigned port, a per-launch bearer token, `Host` and `Origin` validation so a web page in
another origin cannot drive it, and no remote access.

## Consequences

- The first release can be tested with ordinary HTTP and browser tests; no shell is needed
  to prove the core.
- The loopback API is an attack surface even though it is local. It needs its own threat
  model entries, which `docs/local/runner-and-threat-model.md` carries.
- A browser tab is a weaker identity than an installed application. The UI must say what
  it can and cannot see.
- If the prototype finds that neither shell is justified for a one-to-three person team,
  the product can stay a CLI plus loopback UI. That outcome is allowed.

## Evidence

- `docs/migration/capability-register.md` — the `desktop.tauri` row and its status.
- `packages/ui/src/index.ts` — the component library the UI would reuse.
- [`ADR-007`](./007-local-product-separate-from-server-platform.md) — the separation this
  staging depends on.

## Implementation note (2026-10-19)

The interface was built as server-rendered pages with no client framework and not with
`packages/ui`, because the React, Vite and Tailwind dependencies could not be installed where
it was built. The record stays `proposed`. See
[implementation-status.md](../local/implementation-status.md).
