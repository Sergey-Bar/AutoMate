import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

const swaggerMock = vi.hoisted(() => vi.fn());
const swaggerUIMock = vi.hoisted(() => vi.fn());

vi.mock('@fastify/swagger', () => ({
  default: swaggerMock,
}));

vi.mock('@fastify/swagger-ui', () => ({
  default: swaggerUIMock,
}));

describe('registerSwaggerPlugin', () => {
  it('registers both Swagger and SwaggerUI plugins', async () => {
    const app = Fastify({ logger: false });
    const registerSpy = vi.spyOn(app, 'register').mockResolvedValue(undefined as never);

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    expect(registerSpy).toHaveBeenCalledTimes(2);
  });

  it('registers Swagger with correct OpenAPI info', async () => {
    const app = Fastify({ logger: false });
    let swaggerOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      if (!swaggerOptions) {
        swaggerOptions = opts as Record<string, unknown>;
      }
      return app;
    });

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    expect(swaggerOptions).not.toBeNull();
    const openapi = (swaggerOptions as { openapi: Record<string, unknown> }).openapi;
    expect(openapi.openapi).toBe('3.1.0');
    const info = openapi.info as { title: string; version: string; description: string };
    expect(info.title).toBe('Automate API');
    expect(info.version).toBe('0.1.0');
    expect(info.description).toContain('Playwright');
  });

  it('registers Swagger with correct security scheme', async () => {
    const app = Fastify({ logger: false });
    let swaggerOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      if (!swaggerOptions) {
        swaggerOptions = opts as Record<string, unknown>;
      }
      return app;
    });

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    const openapi = (swaggerOptions as { openapi: Record<string, unknown> }).openapi;
    const components = openapi.components as {
      securitySchemes: Record<string, { type: string; scheme: string }>;
    };
    expect(components.securitySchemes.BearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('registers Swagger with all expected API tags', async () => {
    const app = Fastify({ logger: false });
    let swaggerOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      if (!swaggerOptions) {
        swaggerOptions = opts as Record<string, unknown>;
      }
      return app;
    });

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    const openapi = (swaggerOptions as { openapi: Record<string, unknown> }).openapi;
    const tags = openapi.tags as Array<{ name: string }>;
    const tagNames = tags.map((t) => t.name);
    expect(tagNames).toContain('runs');
    expect(tagNames).toContain('tests');
    expect(tagNames).toContain('analytics');
    expect(tagNames).toContain('settings');
    expect(tagNames).toContain('auth');
    expect(tagNames).toContain('system');
  });

  it('registers Swagger with global BearerAuth security', async () => {
    const app = Fastify({ logger: false });
    let swaggerOptions: Record<string, unknown> | null = null;
    app.register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      if (!swaggerOptions) {
        swaggerOptions = opts as Record<string, unknown>;
      }
      return app;
    });

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    const openapi = (swaggerOptions as { openapi: Record<string, unknown> }).openapi;
    expect(openapi.security).toEqual([{ BearerAuth: [] }]);
  });

  it('registers SwaggerUI with /docs route prefix', async () => {
    const app = Fastify({ logger: false });
    const registeredPlugins: Array<[unknown, unknown]> = [];
    app.register = vi.fn(async (plugin: unknown, opts: unknown) => {
      registeredPlugins.push([plugin, opts]);
      return app;
    });

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    // Second registration is SwaggerUI
    const uiOptions = registeredPlugins[1]?.[1] as { routePrefix: string; uiConfig: Record<string, unknown> };
    expect(uiOptions.routePrefix).toBe('/documentation');
  });

  it('registers SwaggerUI with correct UI config', async () => {
    const app = Fastify({ logger: false });
    const registeredPlugins: Array<[unknown, unknown]> = [];
    app.register = vi.fn(async (plugin: unknown, opts: unknown) => {
      registeredPlugins.push([plugin, opts]);
      return app;
    });

    const { registerSwaggerPlugin } = await import('../swagger.js');
    await registerSwaggerPlugin(app);

    const uiOptions = registeredPlugins[1]?.[1] as { uiConfig: Record<string, unknown> };
    expect(uiOptions.uiConfig).toMatchObject({
      docExpansion: 'list',
      deepLinking: true,
      filter: true,
    });
  });
});
