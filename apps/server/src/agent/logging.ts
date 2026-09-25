export function buildExecutionLogRow(
  conversationId: string,
  toolName: string,
  input: unknown,
  output: unknown,
  status: 'running' | 'success' | 'error' | 'timeout',
  durationMs: number,
  errorMessage: string | null,
) {
  return {
    id: crypto.randomUUID(),
    conversationId,
    toolName,
    input: JSON.stringify(input),
    output: output === null ? null : JSON.stringify(output),
    status,
    durationMs,
    errorMessage,
    createdAt: new Date().toISOString(),
  };
}
