import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockGenerateTestsFromDiff = vi.fn();
const mockGenerateTestsFromRequirement = vi.fn();
vi.mock('../services/ai-test-gen.js', () => ({
  generateTestsFromDiff: mockGenerateTestsFromDiff,
  generateTestsFromRequirement: mockGenerateTestsFromRequirement,
  generateTestsFromSource: vi.fn(),
}));
vi.mock('../agent/providers.js', () => ({
  createModelForProvider: vi.fn().mockReturnValue({}),
}));

// Note: requireFeature is a no-op in test env (NODE_ENV=test) by default.
// We mock it here so we can simulate disabled-flag behaviour in one specific test.
const mockRequireFeature = vi.fn().mockReturnValue(async () => {});
vi.mock('../services/feature-flags.js', () => ({
  requireFeature: mockRequireFeature,
  isEnabled: vi.fn().mockReturnValue(false),
}));

const MOCK_DIFF_RESULT = {
  testCode: 'it("from diff", () => {})',
  sourceType: 'pr_diff' as const,
  warnings: [],
};

const MOCK_REQ_RESULT = {
  testCode: 'it("from requirement", () => {})',
  sourceType: 'requirement' as const,
  warnings: [],
};

describe('POST /api/test-generation/from-diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateTestsFromDiff.mockResolvedValue(MOCK_DIFF_RESULT);
    mockRequireFeature.mockReturnValue(async () => {});
  });

  it('returns 200 with GeneratedTestV2 on valid body', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { diff: '--- a/foo.ts\n+++ b/foo.ts\n@@ +1,3 @@\n+export function foo() {}' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(MOCK_DIFF_RESULT);
    await app.close();
  });

  it('returns 200 with optional filePath, language, framework', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: {
        diff: '--- a/foo.ts\n+++ b/foo.ts',
        filePath: 'src/foo.ts',
        language: 'TypeScript',
        framework: 'Vitest',
      },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('forwards diff, filePath, language, framework to service', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { diff: 'the-diff', filePath: 'src/foo.ts', language: 'TypeScript', framework: 'Jest' },
    });

    expect(mockGenerateTestsFromDiff).toHaveBeenCalledWith(
      { diff: 'the-diff', filePath: 'src/foo.ts', language: 'TypeScript', framework: 'Jest' },
      expect.anything(),
    );
    await app.close();
  });

  it('returns 400 when diff is missing', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { filePath: 'foo.ts' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when diff is empty string', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { diff: '' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 500 when generateTestsFromDiff throws', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    mockGenerateTestsFromDiff.mockRejectedValue(new Error('LLM unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { diff: '--- a/foo.ts\n+++ b/foo.ts' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'LLM unavailable' });
    await app.close();
  });

  it('includes warnings array in response', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    mockGenerateTestsFromDiff.mockResolvedValue({
      ...MOCK_DIFF_RESULT,
      warnings: ['Input truncated to 30KB limit'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { diff: 'some large diff' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toContain('Input truncated to 30KB limit');
    await app.close();
  });

  it('returns 404 when feature flag preHandler rejects', async () => {
    // Override requireFeature to simulate disabled flag
    mockRequireFeature.mockReturnValue(async (_req: unknown, reply: { status: (code: number) => { send: (body: unknown) => void } }) => {
      reply.status(404).send({ error: "Feature 'ai-test-gen-v2' is not enabled" });
    });

    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-diff',
      payload: { diff: '--- a/foo.ts' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/test-generation/from-requirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateTestsFromRequirement.mockResolvedValue(MOCK_REQ_RESULT);
    mockRequireFeature.mockReturnValue(async () => {});
  });

  it('returns 200 with GeneratedTestV2 on valid body', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: { requirement: 'User should be able to add two numbers' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(MOCK_REQ_RESULT);
    await app.close();
  });

  it('returns 200 with optional language and framework', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: {
        requirement: 'User should be able to log in',
        language: 'TypeScript',
        framework: 'Vitest',
      },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('forwards requirement, language, framework to service', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: { requirement: 'User login', language: 'TypeScript', framework: 'Vitest' },
    });

    expect(mockGenerateTestsFromRequirement).toHaveBeenCalledWith(
      { requirement: 'User login', language: 'TypeScript', framework: 'Vitest' },
      expect.anything(),
    );
    await app.close();
  });

  it('returns 400 when requirement is missing', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: { language: 'TypeScript' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when requirement is empty string', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: { requirement: '' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 500 when generateTestsFromRequirement throws', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    mockGenerateTestsFromRequirement.mockRejectedValue(new Error('LLM unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: { requirement: 'User should be able to add two numbers' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'LLM unavailable' });
    await app.close();
  });

  it('response has sourceType requirement', async () => {
    const { testGenerationRoutes } = await import('./test-generation.js');
    const app = Fastify({ logger: false });
    await app.register(testGenerationRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/from-requirement',
      payload: { requirement: 'User should be able to add two numbers' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sourceType).toBe('requirement');
    await app.close();
  });
});