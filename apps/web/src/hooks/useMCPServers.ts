import { useState, useEffect } from 'react';

export interface MCPTool {
  name: string;
  description: string;
}

export interface MCPServer {
  id: string;
  name: string;
  status: 'connected' | 'disconnected';
  tools: MCPTool[];
}

const DEFAULT_MCP_SERVERS: MCPServer[] = [
  {
    id: 'playwright',
    name: 'Playwright',
    status: 'connected',
    tools: [
      { name: 'navigate', description: 'Navigate to a URL' },
      { name: 'click', description: 'Click an element' },
      { name: 'fill', description: 'Fill an input field' },
      { name: 'screenshot', description: 'Take a screenshot' },
      { name: 'waitForSelector', description: 'Wait for an element to appear' },
    ],
  },
];

export function useMCPServers() {
  const [data, setData] = useState<MCPServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        const res = await fetch('/api/mcp/servers');
        if (!res.ok) {
          throw new Error(`Failed to fetch MCP servers: ${res.status}`);
        }
        const json = (await res.json()) as MCPServer[];
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
          setData(DEFAULT_MCP_SERVERS);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return { data, isLoading, error };
}
