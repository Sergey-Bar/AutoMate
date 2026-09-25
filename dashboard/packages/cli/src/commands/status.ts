import { fetchApi, getConfig } from '../api-client.js';

interface McpServerInfo {
  id: string;
  name: string;
  running: boolean;
}

export async function run(): Promise<void> {
  const config = getConfig();
  console.log(`\n  Dashboard: ${config.baseUrl}\n`);

  try {
    // Check dashboard health
    await fetchApi('/api/health');
    console.log('  Health:     ● Online');
  } catch {
    console.log('  Health:     ○ Offline or unreachable');
    return;
  }

  try {
    const { servers } = await fetchApi<{ servers: McpServerInfo[] }>('/api/mcp/servers');
    const running = servers.filter((s) => s.running).length;
    console.log(`  MCP:        ${servers.length} registered, ${running} running`);

    if (servers.length > 0) {
      console.log('');
      for (const s of servers) {
        console.log(`    ${s.running ? '●' : '○'} ${s.name} (${s.id})`);
      }
    }
  } catch {
    console.log('  MCP:        Gateway not available');
  }

  console.log('');
}
