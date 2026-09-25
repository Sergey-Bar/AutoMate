interface Registry {
  dispatch(toolName: string, input: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export async function executeToolCall(
  registry: Registry,
  call: { toolName: string; input: unknown },
) {
  return registry.dispatch(call.toolName, call.input);
}
