import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { parsePostmanCollection } from './postman-parser.js';
import { postmanRoutes } from '../routes/postman.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const VALID_FLAT_COLLECTION = JSON.stringify({
  info: {
    name: 'Pet API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'List Pets',
      request: {
        method: 'GET',
        url: { raw: 'https://api.example.com/pets', path: ['pets'] },
        header: [],
        body: null,
      },
    },
  ],
});

const VALID_NESTED_COLLECTION = JSON.stringify({
  info: {
    name: 'Pet API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    version: '2.0',
  },
  item: [
    {
      name: 'List Pets',
      request: {
        method: 'GET',
        url: { raw: 'https://api.example.com/pets', path: ['pets'] },
        header: [],
        body: null,
      },
    },
    {
      name: 'Auth folder',
      item: [
        {
          name: 'Login',
          request: {
            method: 'POST',
            url: { raw: 'https://api.example.com/auth/login' },
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: { mode: 'raw', raw: '{"email":"a@b.com"}' },
          },
        },
      ],
    },
  ],
});

const WRONG_SCHEMA_COLLECTION = JSON.stringify({
  info: {
    name: 'Old API',
    schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json',
  },
  item: [],
});

// ─── parsePostmanCollection tests ────────────────────────────────────────────

describe('parsePostmanCollection', () => {
  it('parses a valid flat collection with 1 GET endpoint (no body)', () => {
    const result = parsePostmanCollection(VALID_FLAT_COLLECTION);

    expect(result.title).toBe('Pet API');
    expect(result.version).toBe('1.0');
    expect(result.baseUrl).toBe('');
    expect(result.endpoints).toHaveLength(1);

    const endpoint = result.endpoints[0];
    expect(endpoint.method).toBe('get');
    expect(endpoint.path).toBe('https://api.example.com/pets');
    expect(endpoint.summary).toBe('List Pets');
    expect(endpoint.operationId).toBeUndefined();
    expect(endpoint.requestBodySchema).toBeUndefined();
    expect(endpoint.responseSchemas).toEqual({});
    expect(endpoint.parameters).toHaveLength(0);
  });

  it('uses path array to resolve URL when raw is missing', () => {
    const collection = JSON.stringify({
      info: {
        name: 'Path API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: { path: ['api', 'users'] },
            header: [],
          },
        },
      ],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints[0].path).toBe('/api/users');
  });

  it('parses a nested folder collection: flattens folder, extracts POST endpoint with body and header', () => {
    const result = parsePostmanCollection(VALID_NESTED_COLLECTION);

    expect(result.title).toBe('Pet API');
    expect(result.version).toBe('2.0');
    expect(result.endpoints).toHaveLength(2);

    const loginEndpoint = result.endpoints.find((e) => e.summary === 'Login');
    expect(loginEndpoint).toBeDefined();
    expect(loginEndpoint!.method).toBe('post');
    expect(loginEndpoint!.path).toBe('https://api.example.com/auth/login');
    expect(loginEndpoint!.requestBodySchema).toEqual({ email: 'a@b.com' });
    expect(loginEndpoint!.parameters).toHaveLength(1);
    expect(loginEndpoint!.parameters[0]).toEqual({
      name: 'Content-Type',
      in: 'header',
      required: false,
      schema: { type: 'string', example: 'application/json' },
    });
  });

  it('throws Error for non-v2.1 schema string', () => {
    expect(() => parsePostmanCollection(WRONG_SCHEMA_COLLECTION)).toThrow(
      /Unsupported Postman schema/,
    );
  });

  it('throws Error for completely invalid JSON input', () => {
    expect(() => parsePostmanCollection('not valid json')).toThrow(/Invalid JSON/);
  });

  it('throws Error when info is missing', () => {
    const bad = JSON.stringify({ item: [] });
    expect(() => parsePostmanCollection(bad)).toThrow(/Invalid Postman collection/);
  });

  it('handles missing url gracefully (empty path)', () => {
    const collection = JSON.stringify({
      info: {
        name: 'No URL API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Endpoint',
          request: {
            method: 'DELETE',
            header: [],
          },
        },
      ],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints[0].path).toBe('');
    expect(result.endpoints[0].method).toBe('delete');
  });

  it('ignores non-JSON body raw content (returns undefined requestBodySchema)', () => {
    const collection = JSON.stringify({
      info: {
        name: 'Form API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Submit Form',
          request: {
            method: 'POST',
            url: { raw: '/submit' },
            header: [],
            body: { mode: 'raw', raw: 'not json at all' },
          },
        },
      ],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints[0].requestBodySchema).toBeUndefined();
  });

  it('ignores body when mode is not raw', () => {
    const collection = JSON.stringify({
      info: {
        name: 'Form API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Upload File',
          request: {
            method: 'POST',
            url: { raw: '/upload' },
            header: [],
            body: { mode: 'formdata' },
          },
        },
      ],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints[0].requestBodySchema).toBeUndefined();
  });

  it('defaults version to "1.0" when info.version is absent', () => {
    const result = parsePostmanCollection(VALID_FLAT_COLLECTION);
    expect(result.version).toBe('1.0');
  });

  it('skips items that have neither request nor sub-items', () => {
    const collection = JSON.stringify({
      info: {
        name: 'Sparse API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        { name: 'Empty item' },
        {
          name: 'Valid endpoint',
          request: {
            method: 'GET',
            url: { raw: '/health' },
            header: [],
          },
        },
      ],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].path).toBe('/health');
  });

  it('handles deeply nested folders', () => {
    const collection = JSON.stringify({
      info: {
        name: 'Nested API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Level 1',
          item: [
            {
              name: 'Level 2',
              item: [
                {
                  name: 'Deep endpoint',
                  request: {
                    method: 'PATCH',
                    url: { raw: '/deep' },
                    header: [],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].method).toBe('patch');
    expect(result.endpoints[0].path).toBe('/deep');
    expect(result.endpoints[0].summary).toBe('Deep endpoint');
  });

  it('returns empty endpoints array for collection with no items', () => {
    const collection = JSON.stringify({
      info: {
        name: 'Empty API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [],
    });

    const result = parsePostmanCollection(collection);
    expect(result.endpoints).toHaveLength(0);
    expect(result.title).toBe('Empty API');
  });
});

// ─── Route tests ─────────────────────────────────────────────────────────────

describe('POST /api/postman/import route', () => {
  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(postmanRoutes);
    await app.ready();
    return app;
  }

  it('returns 200 with ParsedSpec shape for a valid collection', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: VALID_FLAT_COLLECTION },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      title: string;
      version: string;
      baseUrl: string;
      endpoints: Array<{ method: string; path: string }>;
    }>();
    expect(body.title).toBe('Pet API');
    expect(body.version).toBe('1.0');
    expect(body.baseUrl).toBe('');
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0].method).toBe('get');

    await app.close();
  });

  it('returns 200 for nested collection with folders', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: VALID_NESTED_COLLECTION },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ endpoints: Array<{ method: string }> }>();
    expect(body.endpoints).toHaveLength(2);

    await app.close();
  });

  it('returns 400 when collection field is missing', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/collection/);

    await app.close();
  });

  it('returns 400 when collection field is empty string', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: '' },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 for non-v2.1 schema in the collection', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: WRONG_SCHEMA_COLLECTION },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/Unsupported Postman schema/);

    await app.close();
  });

  it('returns 400 for invalid JSON in the collection field', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: 'not valid json' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid JSON/);

    await app.close();
  });
});
