import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GeneratedContractTests } from './contract-test-gen.js';
import type { ParsedSpec } from './openapi-parser.js';

// Mock the 'ai' module BEFORE importing the service
const generateTextMock = vi.fn();
vi.mock('ai', () => ({ generateText: generateTextMock }));

// Import AFTER mocks are set up
const { generateContractTests } = await import('./contract-test-gen.js');

const MOCK_MODEL = {} as Parameters<typeof generateContractTests>[1];

function makeSpec(overrides: Partial<ParsedSpec> = {}): ParsedSpec {
  return {
    title: 'Test API',
    version: '1.0.0',
    baseUrl: 'http://localhost:3000',
    endpoints: [],
    ...overrides,
  };
}

const SINGLE_ENDPOINT_SPEC = makeSpec({
  endpoints: [
    {
      method: 'get',
      path: '/users',
      operationId: 'listUsers',
      summary: 'List all users',
      parameters: [],
      requestBodySchema: undefined,
      responseSchemas: { '200': { type: 'array' } },
    },
  ],
});

const SEVEN_ENDPOINT_SPEC = makeSpec({
  endpoints: Array.from({ length: 7 }, (_, i) => ({
    method: 'get',
    path: `/resource-${i}`,
    operationId: `getResource${i}`,
    summary: undefined,
    parameters: [],
    requestBodySchema: undefined,
    responseSchemas: { '200': {} },
  })),
});

describe('generateContractTests', () => {
  beforeEach(() => {
    generateTextMock.mockResolvedValue({ text: 'it("test", () => {})' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('empty spec', () => {
    it('returns empty result without calling generateText', async () => {
      const spec = makeSpec({ endpoints: [] });
      const result: GeneratedContractTests = await generateContractTests(spec, MOCK_MODEL);

      expect(generateTextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        testCode: '// No endpoints to test',
        endpointsCovered: 0,
        testCount: 0,
      });
    });
  });

  describe('single endpoint (< batch size)', () => {
    it('calls generateText exactly once', async () => {
      await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(generateTextMock).toHaveBeenCalledTimes(1);
    });

    it('returns testCode from mock', async () => {
      const mockCode = 'it("GET /users returns 200", async () => { const res = await fetch("/users"); expect(res.status).toBe(200); })';
      generateTextMock.mockResolvedValue({ text: mockCode });

      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.testCode).toBe(mockCode);
    });

    it('returns correct endpointsCovered', async () => {
      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.endpointsCovered).toBe(1);
    });

    it('passes system and user prompts to generateText', async () => {
      await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as {
        model: unknown;
        system: string;
        prompt: string;
      };
      expect(callArgs.system).toContain('Vitest API contract tests');
      expect(callArgs.prompt).toContain('http://localhost:3000');
      expect(callArgs.prompt).toContain('Test API');
      expect(callArgs.prompt).toContain('GET /users');
    });

    it('includes endpoint summary in prompt', async () => {
      await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('Summary: List all users');
    });

    it('includes expected status codes in prompt', async () => {
      await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('Expected status codes: 200');
    });
  });

  describe('7 endpoints → 2 batches (5 + 2)', () => {
    it('calls generateText exactly twice', async () => {
      await generateContractTests(SEVEN_ENDPOINT_SPEC, MOCK_MODEL);

      expect(generateTextMock).toHaveBeenCalledTimes(2);
    });

    it('returns endpointsCovered = 7', async () => {
      const result = await generateContractTests(SEVEN_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.endpointsCovered).toBe(7);
    });

    it('joins batch outputs with double newline', async () => {
      generateTextMock
        .mockResolvedValueOnce({ text: 'batch1' })
        .mockResolvedValueOnce({ text: 'batch2' });

      const result = await generateContractTests(SEVEN_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.testCode).toBe('batch1\n\nbatch2');
    });
  });

  describe('endpoint summary building', () => {
    it('includes method (uppercased) and path', async () => {
      const spec = makeSpec({
        endpoints: [
          {
            method: 'post',
            path: '/items',
            operationId: 'createItem',
            summary: undefined,
            parameters: [],
            requestBodySchema: undefined,
            responseSchemas: {},
          },
        ],
      });

      await generateContractTests(spec, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('POST /items');
    });

    it('includes parameters with name and location', async () => {
      const spec = makeSpec({
        endpoints: [
          {
            method: 'get',
            path: '/users/{id}',
            operationId: 'getUser',
            summary: undefined,
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'expand', in: 'query', required: false, schema: undefined },
            ],
            requestBodySchema: undefined,
            responseSchemas: {},
          },
        ],
      });

      await generateContractTests(spec, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('id (path)');
      expect(callArgs.prompt).toContain('expand (query)');
    });

    it('omits Parameters line when endpoint has no parameters', async () => {
      const spec = makeSpec({
        endpoints: [
          {
            method: 'get',
            path: '/health',
            operationId: undefined,
            summary: undefined,
            parameters: [],
            requestBodySchema: undefined,
            responseSchemas: {},
          },
        ],
      });

      await generateContractTests(spec, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).not.toContain('Parameters:');
    });

    it('omits Summary line when endpoint has no summary', async () => {
      const spec = makeSpec({
        endpoints: [
          {
            method: 'get',
            path: '/health',
            operationId: undefined,
            summary: undefined,
            parameters: [],
            requestBodySchema: undefined,
            responseSchemas: {},
          },
        ],
      });

      await generateContractTests(spec, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).not.toContain('Summary:');
    });

    it('omits status codes line when responseSchemas is empty', async () => {
      const spec = makeSpec({
        endpoints: [
          {
            method: 'delete',
            path: '/items/{id}',
            operationId: undefined,
            summary: undefined,
            parameters: [],
            requestBodySchema: undefined,
            responseSchemas: {},
          },
        ],
      });

      await generateContractTests(spec, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).not.toContain('Expected status codes:');
    });
  });

  describe('testCount calculation', () => {
    it('counts it( occurrences in generated code', async () => {
      generateTextMock.mockResolvedValue({
        text: 'it("test1", () => {})\nit("test2", () => {})\nit("test3", () => {})',
      });

      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.testCount).toBe(3);
    });

    it('counts test( occurrences as well', async () => {
      generateTextMock.mockResolvedValue({
        text: 'test("test1", () => {})\ntest("test2", () => {})',
      });

      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.testCount).toBe(2);
    });

    it('counts mixed it( and test( occurrences', async () => {
      generateTextMock.mockResolvedValue({
        text: 'it("a", () => {})\ntest("b", () => {})\nit("c", () => {})',
      });

      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.testCount).toBe(3);
    });

    it('returns testCount 0 when no test blocks in generated code', async () => {
      generateTextMock.mockResolvedValue({ text: 'describe("suite", () => {})' });

      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result.testCount).toBe(0);
    });
  });

  describe('baseUrl fallback', () => {
    it('uses http://localhost when baseUrl is empty', async () => {
      const spec = makeSpec({
        baseUrl: '',
        endpoints: [
          {
            method: 'get',
            path: '/ping',
            operationId: undefined,
            summary: undefined,
            parameters: [],
            requestBodySchema: undefined,
            responseSchemas: {},
          },
        ],
      });

      await generateContractTests(spec, MOCK_MODEL);

      const callArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('http://localhost');
    });
  });

  describe('GeneratedContractTests shape', () => {
    it('returns all required fields', async () => {
      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(result).toHaveProperty('testCode');
      expect(result).toHaveProperty('endpointsCovered');
      expect(result).toHaveProperty('testCount');
    });

    it('testCode is a string', async () => {
      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(typeof result.testCode).toBe('string');
    });

    it('endpointsCovered is a number', async () => {
      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(typeof result.endpointsCovered).toBe('number');
    });

    it('testCount is a number', async () => {
      const result = await generateContractTests(SINGLE_ENDPOINT_SPEC, MOCK_MODEL);

      expect(typeof result.testCount).toBe('number');
    });
  });
});
