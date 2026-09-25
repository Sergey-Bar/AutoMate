import { describe, expect, it, vi } from 'vitest';
import { runAgentOnce } from './orchestrator.js';

describe('runAgentOnce', () => {
  it('returns streamed response handle', async () => {
    const result = await runAgentOnce({
      planner: async () => ({ textStream: ['hi'] }),
      executor: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      toolCalls: [],
    });
    expect(result).toBeDefined();
    expect(result.textStream).toContain('hi');
  });

  it('executes tool calls in order', async () => {
    const executed: string[] = [];
    await runAgentOnce({
      planner: async () => ({ textStream: ['done'] }),
      executor: async (call) => {
        executed.push((call as { name: string }).name);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      },
      toolCalls: [{ name: 'a' }, { name: 'b' }],
    });
    expect(executed).toEqual(['a', 'b']);
  });

  it('returns planner result even when toolCalls is empty', async () => {
    const planner = vi.fn(async () => ({ textStream: ['empty run'] }));
    const executor = vi.fn();

    const result = await runAgentOnce({ planner, executor, toolCalls: [] });

    expect(planner).toHaveBeenCalledOnce();
    expect(executor).not.toHaveBeenCalled();
    expect(result.textStream).toContain('empty run');
  });

  it('propagates executor rejection to caller', async () => {
    await expect(
      runAgentOnce({
        planner: async () => ({ textStream: ['plan'] }),
        executor: async () => { throw new Error('executor boom'); },
        toolCalls: [{ id: 'call-1' }],
      }),
    ).rejects.toThrow('executor boom');
  });

  it('propagates planner rejection to caller', async () => {
    await expect(
      runAgentOnce({
        planner: async () => { throw new Error('planner failed'); },
        executor: vi.fn(),
        toolCalls: [],
      }),
    ).rejects.toThrow('planner failed');
  });

  it('calls executor once per tool call with correct argument', async () => {
    const executor = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const calls = [{ id: 'c1', name: 'tool_a' }, { id: 'c2', name: 'tool_b' }, { id: 'c3', name: 'tool_c' }];

    await runAgentOnce({
      planner: async () => ({ textStream: ['ok'] }),
      executor,
      toolCalls: calls,
    });

    expect(executor).toHaveBeenCalledTimes(3);
    expect(executor).toHaveBeenNthCalledWith(1, calls[0]);
    expect(executor).toHaveBeenNthCalledWith(2, calls[1]);
    expect(executor).toHaveBeenNthCalledWith(3, calls[2]);
  });

  it('stops execution at the failing tool call when executor throws', async () => {
    const executed: string[] = [];
    await expect(
      runAgentOnce({
        planner: async () => ({ textStream: ['ok'] }),
        executor: async (call) => {
          const c = call as { name: string };
          if (c.name === 'b') throw new Error('tool b failed');
          executed.push(c.name);
          return { content: [{ type: 'text' as const, text: 'ok' }] };
        },
        toolCalls: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      }),
    ).rejects.toThrow('tool b failed');
    expect(executed).toEqual(['a']);
    expect(executed).not.toContain('c');
  });
});
