import { generateText } from 'ai';
import type { ParsedSpec, ParsedEndpoint } from './openapi-parser.js';

export interface GeneratedContractTests {
  testCode: string;
  endpointsCovered: number;
  testCount: number;
}

const BATCH_SIZE = 5;

function buildEndpointSummary(endpoint: ParsedEndpoint): string {
  const lines = [`${endpoint.method.toUpperCase()} ${endpoint.path}`];
  if (endpoint.summary) lines.push(`  Summary: ${endpoint.summary}`);
  if (endpoint.parameters.length > 0) {
    lines.push(`  Parameters: ${endpoint.parameters.map((p) => `${p.name} (${p.in})`).join(', ')}`);
  }
  const statusCodes = Object.keys(endpoint.responseSchemas);
  if (statusCodes.length > 0) {
    lines.push(`  Expected status codes: ${statusCodes.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Generates Vitest API contract tests for parsed endpoints.
 * Batches endpoints in groups of 5 to avoid context overflow.
 *
 * @param spec   - Parsed OpenAPI spec
 * @param model  - Vercel AI SDK model instance (injected for testability)
 */
export async function generateContractTests(
  spec: ParsedSpec,
  model: Parameters<typeof generateText>[0]['model'],
): Promise<GeneratedContractTests> {
  const { endpoints } = spec;

  if (endpoints.length === 0) {
    return { testCode: '// No endpoints to test', endpointsCovered: 0, testCount: 0 };
  }

  const systemPrompt = `Generate Vitest API contract tests for the given endpoints. Each test should:
1) Send the correct HTTP method to the endpoint
2) Assert response status matches spec
3) Assert response body matches the schema shape (use Zod or manual field checks).
Use fetch() for HTTP calls.`;

  // Process in batches of BATCH_SIZE
  const batches: ParsedEndpoint[][] = [];
  for (let i = 0; i < endpoints.length; i += BATCH_SIZE) {
    batches.push(endpoints.slice(i, i + BATCH_SIZE));
  }

  const parts: string[] = [];
  for (const batch of batches) {
    const endpointDescriptions = batch.map(buildEndpointSummary).join('\n\n');
    const userPrompt = `API Base URL: ${spec.baseUrl || 'http://localhost'}\nAPI Title: ${spec.title}\n\nEndpoints:\n${endpointDescriptions}`;

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
    });
    parts.push(text);
  }

  const testCode = parts.join('\n\n');

  // Estimate test count by counting 'it(' or 'test(' occurrences
  const testCount = (testCode.match(/\bit\s*\(|\btest\s*\(/g) ?? []).length;

  return {
    testCode,
    endpointsCovered: endpoints.length,
    testCount,
  };
}
