export async function runAgentOnce(deps: {
  planner: () => Promise<{ textStream: Iterable<string> }>;
  executor: (call: unknown) => Promise<unknown>;
  toolCalls: unknown[];
}) {
  const planResult = await deps.planner();

  for (const call of deps.toolCalls) {
    await deps.executor(call);
  }

  return planResult;
}

export { createOrchestrator } from './orchestrator-loop.js';

