import { describe, expect, it } from 'vitest';
import {
  filterAllowedTools,
  isToolAllowed,
  MCP_V1_TOOL_ALLOWLIST,
} from './mcp-tool-policy.js';

describe('mcp tool policy', () => {
  it('allows all locked v1 tools', () => {
    for (const toolName of MCP_V1_TOOL_ALLOWLIST) {
      expect(isToolAllowed(toolName)).toBe(true);
    }
  });

  it('denies non-allowlisted tools', () => {
    expect(isToolAllowed('tests.unknown_tool')).toBe(false);
  });

  it('filters discovered tools into allowed and denied groups', () => {
    const result = filterAllowedTools([
      { name: 'runs.list_recent' },
      { name: 'tests.unknown_tool' },
      { name: 'tests.get_error_clusters' },
    ]);

    expect(result.allowed.map((tool) => tool.name)).toEqual([
      'runs.list_recent',
      'tests.get_error_clusters',
    ]);
    expect(result.denied).toEqual(['tests.unknown_tool']);
  });
});
