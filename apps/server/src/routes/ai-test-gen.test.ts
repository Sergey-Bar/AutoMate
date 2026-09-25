import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

const mockGenerateTestsFromSource = vi.fn();
vi.mock('../services/ai-test-gen.js', () => ({
  generateTestsFromSource: mockGenerateTestsFromSource,
}));
vi.mock('../agent/providers.js', () => ({
  createModelForProvider: vi.fn().mockReturnValue({}),
}));

describe('POST /api/ai/generate-test', () => {
  it('returns 200 with GeneratedTest on valid body', async () => {
    const { aiTestGenRoutes } = await import('./ai-test-gen.js');
    const app = Fastify({ logger: false });
    await app.register(aiTestGenRoutes);
    await app.ready();

    const mockResult = {
      testCode: 'it("should work", () => {})',
      testFileName: 'foo.test.ts',
      functionsAnalyzed: ['foo'],
      prompt: 'test prompt',
    };
    mockGenerateTestsFromSource.mockResolvedValue(mockResult);

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/generate-test',
      payload: { sourceCode: 'export function foo() {}', filePath: 'foo.ts' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(mockResult);
    await app.close();
  });

  it('returns 400 when sourceCode is missing', async () => {
    const { aiTestGenRoutes } = await import('./ai-test-gen.js');
    const app = Fastify({ logger: false });
    await app.register(aiTestGenRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/generate-test',
      payload: { filePath: 'foo.ts' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when filePath is missing', async () => {
    const { aiTestGenRoutes } = await import('./ai-test-gen.js');
    const app = Fastify({ logger: false });
    await app.register(aiTestGenRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/generate-test',
      payload: { sourceCode: 'export function foo() {}' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 500 when generateTestsFromSource throws', async () => {
    const { aiTestGenRoutes } = await import('./ai-test-gen.js');
    const app = Fastify({ logger: false });
    await app.register(aiTestGenRoutes);
    await app.ready();

    mockGenerateTestsFromSource.mockRejectedValue(new Error('LLM unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/generate-test',
      payload: { sourceCode: 'export function foo() {}', filePath: 'foo.ts' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'LLM unavailable' });
    await app.close();
  });
});
