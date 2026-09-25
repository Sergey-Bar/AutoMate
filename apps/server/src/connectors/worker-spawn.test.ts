import { describe, expect, it } from 'vitest';
import { buildSpawnCommand } from './worker-spawn.js';

describe('buildSpawnCommand', () => {
  it('returns command and args for a connector path', () => {
    const result = buildSpawnCommand('/path/to/connector.js');
    expect(result).toHaveProperty('command');
    expect(result).toHaveProperty('args');
    expect(Array.isArray(result.args)).toBe(true);
  });

  it('uses node as the command', () => {
    const result = buildSpawnCommand('/path/to/connector.js');
    expect(result.command).toBe('node');
  });

  it('includes the connector path in args', () => {
    const result = buildSpawnCommand('/path/to/connector.js');
    expect(result.args).toContain('/path/to/connector.js');
  });

  it('includes --stdio flag in args', () => {
    const result = buildSpawnCommand('/path/to/connector.js');
    expect(result.args).toContain('--stdio');
  });

  it('accepts optional extra env vars', () => {
    const result = buildSpawnCommand('/path/to/connector.js', { NODE_ENV: 'production' });
    expect(result.env).toEqual({ NODE_ENV: 'production' });
  });
});
