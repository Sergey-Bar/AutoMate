# @automate/tool-sdk

The contract between the agent routes and whatever executes work for them: operation
declaration, adapter dispatch, result normalisation, and error classification.

A leaf package. It starts no process, opens no socket and touches no database; an
`AgentAdapter` supplied by an app or another package does the work, and this package decides
whether the request is valid, how long it may take, whether a failure is worth repeating, and
what the caller is told.

```ts
const registry = createToolRegistry();
registry.register(
  runResultOperation({
    domain: 'load',
    action: 'run',
    input: z.object({ script: z.string() }),
    idempotent: true,
    timeoutMs: 60_000,
    normalise: (raw, input) => k6ToRunResult(raw, input),
  }),
  k6Adapter,
);
const result = await registry.dispatch('load', 'run', { script: 'smoke.js' });
```

An operation with no registered adapter yields `kind: 'configuration'`, which
`toAgentProblem` renders as the `501 AGENT_NOT_CONFIGURED` body `apps/api` answers today.

An adapter that finds the request wrong in a way only the tool can see throws
`ToolInputError`, which is rendered as a `400` that keeps its wording.

The first real adapter is `browser.run` in `apps/api` (`src/agents/browser-adapter.ts`); `api.run` (`src/agents/api-adapter.ts`) follows it. They
is built on `src/agents/execution-bridge.ts`, which any domain whose tool already runs as an
execution job can reuse: `defineAcceptedRunOperation` declares the operation (its answer is the
accepted run and links to it), and `createExecutionBridgeAdapter` queues the run through the same
`submitRun` that `POST /api/v1/runs` uses.

```bash
pnpm --filter @automate/tool-sdk test
```

Part of the [Automate](https://github.com/Sergey-Bar/AutoMate) monorepo; see the root README for the whole picture.
