import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// Hoist mocks before any imports
const mockParseOpenApiSpec = vi.fn();
const mockGenerateContractTests = vi.fn();
const mockCreateModelForProvider = vi.fn(() => ({}));

vi.mock('../services/openapi-parser.js', () => ({
  parseOpenApiSpec: mockParseOpenApiSpec,
}));

vi.mock('../services/contract-test-gen.js', () => ({
  generateContractTests: mockGenerateContractTests,
}));

vi.mock('../agent/providers.js', () => ({
  createModelForProvider: mockCreateModelForProvider,
}));

// Import AFTER mocks
const { openApiRoutes } = await import('./openapi.js');

const MINIMAL_OPENAPI_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});

const PARSED_SPEC = {
  title: 'Test API',
  version: '1.0.0',
  baseUrl: 'http://localhost',
  endpoints: [
    {
      method: 'get',
      path: '/users',
      operationId: 'listUsers',
      summary: undefined,
      parameters: [],
      requestBodySchema: undefined,
      responseSchemas: { '200': {} },
    },
  ],
};

const MOCK_RESULT = {
  testCode: 'it("GET /users returns 200", async () => {})',
  endpointsCovered: 1,
  testCount: 1,
};

describe('POST /api/openapi/generate-tests', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockParseOpenApiSpec.mockResolvedValue(PARSED_SPEC);
    mockGenerateContractTests.mockResolvedValue(MOCK_RESULT);

    app = Fastify();
    await app.register(openApiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with testCode, endpointsCovered, testCount on valid spec', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/generate-tests',
      payload: { spec: MINIMAL_OPENAPI_SPEC },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(MOCK_RESULT);
    expect(mockParseOpenApiSpec).toHaveBeenCalledWith(MINIMAL_OPENAPI_SPEC);
    expect(mockGenerateContractTests).toHaveBeenCalledOnce();
  });

  it('returns 400 when spec is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/generate-tests',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
    expect(mockGenerateContractTests).not.toHaveBeenCalled();
  });

  it('returns 400 when spec is empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/generate-tests',
      payload: { spec: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
    expect(mockGenerateContractTests).not.toHaveBeenCalled();
  });

  it('returns 400 when spec is invalid (parseOpenApiSpec throws)', async () => {
    mockParseOpenApiSpec.mockRejectedValue(new Error('Invalid OpenAPI spec'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/generate-tests',
      payload: { spec: '{"not": "valid openapi"}' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid OpenAPI spec' });
    expect(mockGenerateContractTests).not.toHaveBeenCalled();
  });

  it('returns 500 when generateContractTests throws', async () => {
    mockGenerateContractTests.mockRejectedValue(new Error('AI model unreachable'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/generate-tests',
      payload: { spec: MINIMAL_OPENAPI_SPEC },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'AI model unreachable' });
  });

  it('passes the model from createModelForProvider to generateContractTests', async () => {
    const fakeModel = { provider: 'ollama', modelId: 'llama3.1' };
    mockCreateModelForProvider.mockReturnValue(fakeModel);

    await app.inject({
      method: 'POST',
      url: '/api/openapi/generate-tests',
      payload: { spec: MINIMAL_OPENAPI_SPEC },
    });

    expect(mockCreateModelForProvider).toHaveBeenCalledWith({
      provider: 'ollama',
      model: expect.any(String),
      endpoint: expect.any(String),
    });
    const [, calledModel] = mockGenerateContractTests.mock.calls[0] as [unknown, unknown];
    expect(calledModel).toBe(fakeModel);
  });
});

describe('POST /api/openapi/parse', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockParseOpenApiSpec.mockResolvedValue(PARSED_SPEC);

    app = Fastify();
    await app.register(openApiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with parsed spec on valid input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: { spec: MINIMAL_OPENAPI_SPEC },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(PARSED_SPEC);
  });

  it('returns 400 when spec is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
  });

  it('returns 400 when parseOpenApiSpec throws', async () => {
    mockParseOpenApiSpec.mockRejectedValue(new Error('Bad spec'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/openapi/parse',
      payload: { spec: '{}' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Bad spec' });
  });
});
