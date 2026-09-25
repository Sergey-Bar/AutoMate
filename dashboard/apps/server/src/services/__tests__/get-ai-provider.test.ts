/**
 * Tests for the getAiProvider() helper added to ai-provider-registry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock fs/promises to control config file reads
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: fsMocks.readFile,
}));

describe('getAiProvider()', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws "No AI provider configured" when config file does not exist', async () => {
    fsMocks.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

    const { getAiProvider } = await import('../ai-provider-registry.js');

    await expect(getAiProvider()).rejects.toThrow('No AI provider configured');
  });

  it('throws "No AI provider configured" when config JSON is invalid', async () => {
    fsMocks.readFile.mockResolvedValue('not-valid-json{{{');

    const { getAiProvider } = await import('../ai-provider-registry.js');

    await expect(getAiProvider()).rejects.toThrow('No AI provider configured');
  });

  it('returns config and adapter when config is valid', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'openai', apiKey: 'sk-test-key', model: 'gpt-4o-mini' }),
    );

    const { getAiProvider } = await import('../ai-provider-registry.js');
    const result = await getAiProvider();

    expect(result.config.provider).toBe('openai');
    expect(result.adapter).toBeDefined();
    expect(result.adapter.name).toBe('openai');
  });

  it('returns config and adapter for ollama provider', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'ollama', model: 'llama3.1' }),
    );

    const { getAiProvider } = await import('../ai-provider-registry.js');
    const result = await getAiProvider();

    expect(result.config.provider).toBe('ollama');
    expect(result.adapter.name).toBe('ollama');
  });
});
