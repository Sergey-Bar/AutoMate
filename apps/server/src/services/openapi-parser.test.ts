import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { parseOpenApiSpec } from './openapi-parser.js';
import { openApiRoutes } from '../routes/openapi.js';

const VALID_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Pet API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'A list of pets' } },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
  },
});

const INVALID_SPEC = JSON.stringify({
  openapi: '3.0.0',
  // missing required "info" field
  paths: {},
});

describe('parseOpenApiSpec', () => {
  it('parses a valid OpenAPI 3.0 spec and returns structured data', async () => {
    const result = await parseOpenApiSpec(VALID_SPEC);

    expect(result.title).toBe('Pet API');
    expect(result.version).toBe('1.0.0');
    expect(result.baseUrl).toBe('https://api.example.com');
    expect(result.endpoints).toHaveLength(2);

    const getEndpoint = result.endpoints.find((e) => e.method === 'get');
    expect(getEndpoint).toBeDefined();
    expect(getEndpoint?.path).toBe('/pets');
    expect(getEndpoint?.operationId).toBe('listPets');
    expect(getEndpoint?.summary).toBe('List all pets');
    expect(getEndpoint?.parameters).toHaveLength(1);
    expect(getEndpoint?.parameters[0]).toEqual({
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer' },
    });

    const postEndpoint = result.endpoints.find((e) => e.method === 'post');
    expect(postEndpoint).toBeDefined();
    expect(postEndpoint?.path).toBe('/pets');
    expect(postEndpoint?.operationId).toBe('createPet');
    expect(postEndpoint?.requestBodySchema).toBeDefined();
    expect(postEndpoint?.requestBodySchema).toMatchObject({ type: 'object' });
  });

  it('throws an error for invalid JSON input', async () => {
    await expect(parseOpenApiSpec('not valid json')).rejects.toThrow(/Invalid JSON/);
  });

  it('throws an error for an invalid OpenAPI spec (schema validation failure)', async () => {
    await expect(parseOpenApiSpec(INVALID_SPEC)).rejects.toThrow(/Invalid OpenAPI spec/);
  });

  it('throws for Swagger 2.0 spec (not supported)', async () => {
    const swagger2Spec = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Old API', version: '1.0.0' },
      host: 'api.example.com',
      paths: {},
    });
    await expect(parseOpenApiSpec(swagger2Spec)).rejects.toThrow(
      /Only OpenAPI 3.0 specs are supported/,
    );
  });

  it('extracts request body schema from non-JSON content type as fallback', async () => {
    const specWithTextBody = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Text API', version: '1.0.0' },
      paths: {
        '/upload': {
          post: {
            operationId: 'uploadText',
            summary: 'Upload text',
            requestBody: {
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });

    const result = await parseOpenApiSpec(specWithTextBody);
    const endpoint = result.endpoints.find((e) => e.operationId === 'uploadText');
    expect(endpoint).toBeDefined();
    expect(endpoint?.requestBodySchema).toEqual({ type: 'string' });
  });

  it('returns undefined requestBodySchema when content has no schema', async () => {
    const specNoSchema = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'No Schema API', version: '1.0.0' },
      paths: {
        '/upload': {
          post: {
            operationId: 'uploadNoSchema',
            summary: 'Upload without schema',
            requestBody: {
              content: {
                'text/plain': {},
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });

    const result = await parseOpenApiSpec(specNoSchema);
    const endpoint = result.endpoints.find((e) => e.operationId === 'uploadNoSchema');
    expect(endpoint).toBeDefined();
    expect(endpoint?.requestBodySchema).toBeUndefined();
  });

  it('omits response schemas when response content is not application/json', async () => {
    const specWithXmlResponse = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'XML API', version: '1.0.0' },
      paths: {
        '/data': {
          get: {
            operationId: 'getData',
            summary: 'Get XML data',
            responses: {
              '200': {
                description: 'XML response',
                content: {
                  'application/xml': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    });

    const result = await parseOpenApiSpec(specWithXmlResponse);
    const endpoint = result.endpoints.find((e) => e.operationId === 'getData');
    expect(endpoint).toBeDefined();
    expect(endpoint?.responseSchemas).toEqual({});
  });

  it('handles a spec with no servers gracefully', async () => {
    const specNoServers = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'No Servers API', version: '0.0.1' },
      paths: {},
    });
    const result = await parseOpenApiSpec(specNoServers);
    expect(result.baseUrl).toBe('');
    expect(result.endpoints).toHaveLength(0);
  });
});

describe('POST /api/openapi/parse route', () => {
  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(openApiRoutes);
    await app.ready();
    return app;
  }

  it('returns 200 with parsed spec for a valid OpenAPI 3.0 spec', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: { spec: VALID_SPEC },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ title: string; version: string; baseUrl: string; endpoints: unknown[] }>();
    expect(body.title).toBe('Pet API');
    expect(body.version).toBe('1.0.0');
    expect(body.baseUrl).toBe('https://api.example.com');
    expect(body.endpoints).toHaveLength(2);

    await app.close();
  });

  it('returns 400 for an invalid OpenAPI spec', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: { spec: INVALID_SPEC },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid OpenAPI spec/);

    await app.close();
  });

  it('returns 400 when spec field is missing', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/spec/);

    await app.close();
  });

  it('returns 400 for invalid JSON in the spec field', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: { spec: 'not valid json at all' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid JSON/);

    await app.close();
  });
});
