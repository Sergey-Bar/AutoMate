/**
 * Builds a spawn command for launching an external MCP connector process.
 * Used when connectors run as child processes communicating via stdio.
 */
export function buildSpawnCommand(
  connectorPath: string,
  env?: Record<string, string>,
): { command: string; args: string[]; env?: Record<string, string> } {
  return {
    command: 'node',
    args: [connectorPath, '--stdio'],
    ...(env ? { env } : {}),
  };
}
