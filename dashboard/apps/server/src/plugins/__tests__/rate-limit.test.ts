import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const rateLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@fastify/rate-limit', () => ({
  default: rateLimitMock,
}));

describe('registerRateLimitPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: register succeeds as a Fastify plugin
    rateLimitMock.mockImplementation(async () => {});
  });

  it('registers the rate-limit plugin with correct config', async () => {
    const app = Fastify({ logger: false });
    // Capture the plugin registration arguments
    let capturedOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (plugin: unknown, opts: unknown) => {
      capturedOptions = opts as Record<string, unknown>;
      return app;
    });

    const { registerRateLimitPlugin } = await import('../rate-limit.js');
    await registerRateLimitPlugin(app);

    expect(app.register).toHaveBeenCalledTimes(1);
    expect(capturedOptions).toMatchObject({
      max: 200,
      timeWindow: '1 minute',
    });
    expect(typeof capturedOptions!.allowList).toBe('function');
  });

  it('allowList returns true for /health/* URLs', async () => {
    const app = Fastify({ logger: false });
    let capturedOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      capturedOptions = opts as Record<string, unknown>;
      return app;
    });

    const { registerRateLimitPlugin } = await import('../rate-limit.js');
    await registerRateLimitPlugin(app);

    const allowList = capturedOptions!.allowList as (req: { url?: string }) => boolean;

    expect(allowList({ url: '/health' })).toBe(true);
    expect(allowList({ url: '/health/live' })).toBe(true);
    expect(allowList({ url: '/health/ready' })).toBe(true);
  });

  it('allowList returns false for non-health URLs', async () => {
    const app = Fastify({ logger: false });
    let capturedOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      capturedOptions = opts as Record<string, unknown>;
      return app;
    });

    const { registerRateLimitPlugin } = await import('../rate-limit.js');
    await registerRateLimitPlugin(app);

    const allowList = capturedOptions!.allowList as (req: { url?: string }) => boolean;

    expect(allowList({ url: '/api/runs' })).toBe(false);
    expect(allowList({ url: '/docs' })).toBe(false);
    expect(allowList({ url: '/' })).toBe(false);
    expect(allowList({ url: '/ws' })).toBe(false);
  });

  it('allowList handles undefined url (returns false)', async () => {
    const app = Fastify({ logger: false });
    let capturedOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      capturedOptions = opts as Record<string, unknown>;
      return app;
    });

    const { registerRateLimitPlugin } = await import('../rate-limit.js');
    await registerRateLimitPlugin(app);

    const allowList = capturedOptions!.allowList as (req: { url?: string }) => boolean;

    expect(allowList({ url: undefined })).toBe(false);
    expect(allowList({})).toBe(false);
  });

  it('calls app.register with the rateLimit plugin', async () => {
    const app = Fastify({ logger: false });
    const registerSpy = vi.spyOn(app, 'register').mockResolvedValue(undefined as never);

    const { registerRateLimitPlugin } = await import('../rate-limit.js');
    await registerRateLimitPlugin(app);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    // First argument should be the rateLimit plugin import
    expect(registerSpy.mock.calls[0][0]).toBeDefined();
  });
});
