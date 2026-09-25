import { fetchApi } from '../api-client.js';

interface McpServerInfo {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
  toolPrefix: string;
  running: boolean;
}

interface McpServerStatus extends McpServerInfo {
  pid: number | null;
}

async function listServers(): Promise<void> {
  const { servers } = await fetchApi<{ servers: McpServerInfo[] }>('/api/mcp/servers');

  if (servers.length === 0) {
    console.log('No MCP servers registered.');
    return;
  }

  console.log('\nMCP Servers:\n');
  console.log('  ID                  Name                 Transport  Prefix     Enabled  Running');
  console.log('  ' + '─'.repeat(80));
  for (const s of servers) {
    console.log(
      `  ${s.id.padEnd(20)} ${s.name.padEnd(20)} ${s.transport.padEnd(10)} ${s.toolPrefix.padEnd(10)} ${String(s.enabled).padEnd(8)} ${s.running ? '●' : '○'}`
    );
  }
  console.log('');
}

async function showStatus(serverId: string): Promise<void> {
  const status = await fetchApi<McpServerStatus>(`/api/mcp/servers/${serverId}/status`);

  console.log(`\nMCP Server: ${status.name} (${status.id})\n`);
  console.log(`  Transport:  ${status.transport}`);
  console.log(`  Prefix:     ${status.toolPrefix}`);
  console.log(`  Enabled:    ${status.enabled}`);
  console.log(`  Running:    ${status.running ? '● Yes' : '○ No'}`);
  if (status.pid !== null) {
    console.log(`  PID:        ${status.pid}`);
  }
  console.log('');
}

async function startServer(serverId: string): Promise<void> {
  const result = await fetchApi<{ message: string }>(`/api/mcp/servers/${serverId}/start`, { method: 'POST' });
  console.log(`✓ ${result.message}`);
}

async function stopServer(serverId: string): Promise<void> {
  const result = await fetchApi<{ message: string }>(`/api/mcp/servers/${serverId}/stop`, { method: 'POST' });
  console.log(`✓ ${result.message}`);
}

function printMcpUsage(): void {
  console.log('Usage: Automate mcp <subcommand> [options]\n');
  console.log('Subcommands:');
  console.log('  list              List all registered MCP servers');
  console.log('  status <id>       Show status of a specific MCP server');
  console.log('  start <id>        Start an MCP server');
  console.log('  stop <id>         Stop an MCP server');
}

export async function run(args: string[]): Promise<void> {
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'list':
        await listServers();
        break;
      case 'status': {
        const id = args[1];
        if (!id) {
          console.error('Error: server ID is required. Usage: Automate mcp status <id>');
          process.exit(1);
          return;
        }
        await showStatus(id);
        break;
      }
      case 'start': {
        const id = args[1];
        if (!id) {
          console.error('Error: server ID is required. Usage: Automate mcp start <id>');
          process.exit(1);
          return;
        }
        await startServer(id);
        break;
      }
      case 'stop': {
        const id = args[1];
        if (!id) {
          console.error('Error: server ID is required. Usage: Automate mcp stop <id>');
          process.exit(1);
          return;
        }
        await stopServer(id);
        break;
      }
      default:
        printMcpUsage();
        break;
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
