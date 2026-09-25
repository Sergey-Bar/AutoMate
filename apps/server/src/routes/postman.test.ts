import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { postmanRoutes } from './postman.js';

// requireFeature bypasses in NODE_ENV=test (returns immediately), so no need to mock it.
// Mock parsePostmanCollection so we can test error handling without real JSON.
vi.mock('../services/postman-parser.js', () => ({
  parsePostmanCollection: vi.fn(),
}));

import { parsePostmanCollection } from '../services/postman-parser.js';

const VALID_COLLECTION_JSON = JSON.stringify({
  info: {
    name: 'My API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'Get users',
      request: {
        method: 'GET',
        url: { raw: 'https://api.example.com/users' },
      },
    },
  ],
});

const PARSED_RESULT = {
  title: 'My API',
  version: '1.0',
  baseUrl: '',
  endpoints: [
    {
      method: 'get',
      path: 'https://api.example.com/users',
      operationId: undefined,
      summary: 'Get users',
      requestBodySchema: undefined,
      responseSchemas: {},
      parameters: [],
    },
  ],
};

describe('postmanRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(postmanRoutes);
    await app.ready();
  });

  it('POST /api/postman/import returns 200 with parsed collection on valid input', async () => {
    vi.mocked(parsePostmanCollection).mockReturnValue(PARSED_RESULT);

    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: VALID_COLLECTION_JSON },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe('My API');
    expect(body.endpoints).toHaveLength(1);
    expect(parsePostmanCollection).toHaveBeenCalledWith(VALID_COLLECTION_JSON);
  });

  it('POST /api/postman/import returns 400 when collection is an empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: '' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(parsePostmanCollection).not.toHaveBeenCalled();
  });

  it('POST /api/postman/import returns 400 when collection field is missing from body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(parsePostmanCollection).not.toHaveBeenCalled();
  });

  it('POST /api/postman/import returns 400 when request body is entirely missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(parsePostmanCollection).not.toHaveBeenCalled();
  });

  it('POST /api/postman/import returns 400 when parser throws an error', async () => {
    vi.mocked(parsePostmanCollection).mockImplementation(() => {
      throw new Error('Invalid JSON: Unexpected token');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: 'this is not json' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Invalid JSON');
  });

  it('POST /api/postman/import returns 400 when parser throws for unsupported schema', async () => {
    vi.mocked(parsePostmanCollection).mockImplementation(() => {
      throw new Error('Unsupported Postman schema: "v1.0". Only v2.1 is supported.');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: '{"info":{"name":"x","schema":"v1.0"},"item":[]}' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toContain('Unsupported Postman schema');
  });

  it('POST /api/postman/import returns 400 when collection field is not a string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: 42 },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(parsePostmanCollection).not.toHaveBeenCalled();
  });

  it('POST /api/postman/import calls parsePostmanCollection with the exact collection string', async () => {
    vi.mocked(parsePostmanCollection).mockReturnValue(PARSED_RESULT);
    const collectionStr = '{"info":{"name":"test","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[]}';

    await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      payload: { collection: collectionStr },
    });

    expect(parsePostmanCollection).toHaveBeenCalledTimes(1);
    expect(parsePostmanCollection).toHaveBeenCalledWith(collectionStr);
  });
});
