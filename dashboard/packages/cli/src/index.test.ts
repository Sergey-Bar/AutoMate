import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('index (CLI entrypoint)', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

  // Mock the command modules so dynamic imports don't actually run commands
  vi.mock('./commands/init.js', () => ({
    run: vi.fn().mockResolvedValue(undefined),
  }));
  vi.mock('./commands/mcp.js', () => ({
    run: vi.fn().mockResolvedValue(undefined),
  }));
  vi.mock('./commands/status.js', () => ({
    run: vi.fn().mockResolvedValue(undefined),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadIndexWithArgs(args: string[]): Promise<void> {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js', ...args];
    try {
      await import('./index.js');
    } finally {
      process.argv = originalArgv;
    }
  }

  it('prints usage and exits 0 when no command is given', async () => {
    await loadIndexWithArgs([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('prints usage and exits 1 when unknown command is given', async () => {
    await loadIndexWithArgs(['unknown-command']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('prints usage for help command', async () => {
    await loadIndexWithArgs(['help']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints usage for --help flag', async () => {
    await loadIndexWithArgs(['--help']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('prints usage for -h flag', async () => {
    await loadIndexWithArgs(['-h']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('calls init command when "init" is given', async () => {
    const { run } = await import('./commands/init.js');
    await loadIndexWithArgs(['init']);

    expect(run).toHaveBeenCalled();
  });

  it('calls status command when "status" is given', async () => {
    const { run } = await import('./commands/status.js');
    await loadIndexWithArgs(['status']);

    expect(run).toHaveBeenCalled();
  });

  it('calls mcp command with remaining args when "mcp" is given', async () => {
    const { run } = await import('./commands/mcp.js');
    await loadIndexWithArgs(['mcp', 'list']);

    expect(run).toHaveBeenCalledWith(['list']);
  });
});
