import { describe, expect, it, vi, beforeEach } from 'vitest';
import { gateOrchestratorManifest } from './gate-orchestrator.js';

const mockConnect = vi.hoisted(() => vi.fn());
const mockDisconnect = vi.hoisted(() => vi.fn());
const mockCallTool = vi.hoisted(() => vi.fn());

vi.mock('./mcp-client.js', () => ({
  createDashboardMcpClient: vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    callTool: mockCallTool,
    listTools: vi.fn(),
  })),
}));

describe('gateOrchestratorManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
  });

  it('has the correct connector name and tool name', () => {
    expect(gateOrchestratorManifest.name).toBe('gate_orchestrator');
    expect(gateOrchestratorManifest.tools).toHaveLength(1);
    expect(gateOrchestratorManifest.tools[0]?.name).toBe('check_quality_gate');
  });

  it('check_quality_gate returns gate status from Dashboard MCP', async () => {
    const gateResult = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          gateStatus: 'passed',
          passed: true,
          passRate: 95,
          threshold: 90,
          failedTests: 1,
          totalTests: 20,
        }),
      }],
      isError: false,
    };
    mockCallTool.mockResolvedValue(gateResult);

    const tool = gateOrchestratorManifest.tools[0];
    const result = await tool!.handler({ runId: 'run-123' }, {
      credentials: {},
      abortSignal: new AbortController().signal,
    });

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockCallTool).toHaveBeenCalledWith('runs.get_gate_status', { runId: 'run-123' });
    expect(mockDisconnect).toHaveBeenCalledOnce();
    expect(result).toEqual(gateResult);
  });

  it('check_quality_gate returns error when runId is missing', async () => {
    const tool = gateOrchestratorManifest.tools[0];
    const result = await tool!.handler({}, {
      credentials: {},
      abortSignal: new AbortController().signal,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('runId is required');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('check_quality_gate returns helpful error when Dashboard MCP is unavailable', async () => {
    mockConnect.mockRejectedValue(new Error('Dashboard MCP unavailable during connect. Check DASHBOARD_MCP_URL/DASHBOARD_MCP_API_KEY'));

    const tool = gateOrchestratorManifest.tools[0];
    const result = await tool!.handler({ runId: 'run-abc' }, {
      credentials: {},
      abortSignal: new AbortController().signal,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Quality gate check failed');
    expect(result.content[0]?.text).toContain('Dashboard');
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('check_quality_gate disconnects even when callTool throws', async () => {
    mockCallTool.mockRejectedValue(new Error('Tool timeout'));

    const tool = gateOrchestratorManifest.tools[0];
    const result = await tool!.handler({ runId: 'run-xyz' }, {
      credentials: {},
      abortSignal: new AbortController().signal,
    });

    expect(result.isError).toBe(true);
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('check_quality_gate tool description mentions gate and threshold', () => {
    const tool = gateOrchestratorManifest.tools[0];
    expect(tool?.description.toLowerCase()).toContain('gate');
    expect(tool?.description.toLowerCase()).toContain('threshold');
  });
});
