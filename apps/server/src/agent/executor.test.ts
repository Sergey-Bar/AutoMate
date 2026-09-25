import { describe, expect, it, vi } from 'vitest';
import { executeToolCall } from './executor.js';

describe('executor', () => {
  it('dispatches call to connector registry', async () => {
    const result = await executeToolCall(
      { dispatch: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }) },
      { toolName: 'github.create_issue', input: { title: 'x' } },
    );
    expect(result.content[0].text).toBe('ok');
  });

  it('throws on dispatch failure', async () => {
    const failing = { dispatch: async () => { throw new Error('not found'); } };
    await expect(executeToolCall(failing, { toolName: 'x.y', input: {} })).rejects.toThrow('not found');
  });

  it('passes toolName and input to registry.dispatch', async () => {
    const dispatch = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'result' }] }));
    const input = { repo: 'my-repo', title: 'Bug report' };

    await executeToolCall({ dispatch }, { toolName: 'github.create_issue', input });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('github.create_issue', input);
  });

  it('returns empty content array when registry returns empty content', async () => {
    const result = await executeToolCall(
      { dispatch: async () => ({ content: [] }) },
      { toolName: 'slack.post_message', input: {} },
    );
    expect(result.content).toHaveLength(0);
  });

  it('returns isError flag when registry signals an error result', async () => {
    const result = await executeToolCall(
      { dispatch: async () => ({ content: [{ type: 'text' as const, text: 'bad input' }], isError: true }) },
      { toolName: 'jira.create_issue', input: { title: '' } },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('bad input');
  });

  it('returns multiple content items from registry intact', async () => {
    const dispatch = vi.fn(async () => ({
      content: [
        { type: 'text' as const, text: 'line 1' },
        { type: 'text' as const, text: 'line 2' },
        { type: 'text' as const, text: 'line 3' },
      ],
    }));

    const result = await executeToolCall({ dispatch }, { toolName: 'sql.query', input: { sql: 'SELECT 1' } });

    expect(result.content).toHaveLength(3);
    expect(result.content[1].text).toBe('line 2');
  });

  it('propagates non-Error rejections from registry', async () => {
    const dispatch = vi.fn(async () => {
       
      throw 'unexpected string error';
    });

    await expect(
      executeToolCall({ dispatch }, { toolName: 'unknown.tool', input: {} }),
    ).rejects.toBe('unexpected string error');
  });

  it('passes through unknown tool names without any special handling', async () => {
    const dispatch = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'executed' }] }));

    const result = await executeToolCall(
      { dispatch },
      { toolName: 'totally_unknown__nonexistent_tool', input: { foo: 'bar' } },
    );

    expect(dispatch).toHaveBeenCalledWith('totally_unknown__nonexistent_tool', { foo: 'bar' });
    expect(result.content[0].text).toBe('executed');
  });
});
