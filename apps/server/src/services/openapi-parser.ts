import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3, OpenAPIV2 } from 'openapi-types';

export interface ParsedParameter {
  name: string;
  in: string;
  required: boolean;
  schema: Record<string, unknown> | undefined;
}

export interface ParsedEndpoint {
  method: string;
  path: string;
  operationId: string | undefined;
  summary: string | undefined;
  requestBodySchema: Record<string, unknown> | undefined;
  responseSchemas: Record<string, unknown>;
  parameters: ParsedParameter[];
}

export interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  endpoints: ParsedEndpoint[];
}

function isOpenApiV3Document(
  doc: OpenAPIV3.Document | OpenAPIV2.Document,
): doc is OpenAPIV3.Document {
  return 'openapi' in doc;
}

function extractRequestBodySchema(
  operation: OpenAPIV3.OperationObject,
): Record<string, unknown> | undefined {
  const requestBody = operation.requestBody;
  if (!requestBody) return undefined;

  // requestBody may be a reference object after parsing, but SwaggerParser.validate dereferences
  const body = requestBody as OpenAPIV3.RequestBodyObject;
  const content = body.content;
  if (!content) return undefined;

  // Prefer application/json
  const jsonContent = content['application/json'];
  if (jsonContent?.schema) {
    return jsonContent.schema as Record<string, unknown>;
  }

  // Fall back to first available content type
  const firstKey = Object.keys(content)[0];
  if (firstKey && content[firstKey]?.schema) {
    return content[firstKey].schema as Record<string, unknown>;
  }

  return undefined;
}

function extractResponseSchemas(
  operation: OpenAPIV3.OperationObject,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const responses = operation.responses;
  if (!responses) return result;

  for (const [statusCode, response] of Object.entries(responses)) {
    const resp = response as OpenAPIV3.ResponseObject;
    const content = resp.content;
    if (!content) continue;

    const jsonContent = content['application/json'];
    if (jsonContent?.schema) {
      result[statusCode] = jsonContent.schema as Record<string, unknown>;
    }
  }

  return result;
}

function extractParameters(
  operation: OpenAPIV3.OperationObject,
): ParsedParameter[] {
  if (!operation.parameters) return [];

  const params = operation.parameters as Array<OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject>;
  return params
    .filter((p): p is OpenAPIV3.ParameterObject => !('$ref' in p))
    .map((param: OpenAPIV3.ParameterObject) => ({
      name: param.name,
      in: param.in,
      required: param.required ?? false,
      schema: param.schema as Record<string, unknown> | undefined,
    }));
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
type HttpMethod = typeof HTTP_METHODS[number];

function isHttpMethod(key: string): key is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(key);
}

export async function parseOpenApiSpec(specContent: string): Promise<ParsedSpec> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(specContent);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  let doc: OpenAPIV3.Document | OpenAPIV2.Document;
  try {
    doc = (await SwaggerParser.validate(
      parsedJson as Parameters<typeof SwaggerParser.validate>[0],
    )) as OpenAPIV3.Document | OpenAPIV2.Document;
  } catch (err) {
    throw new Error(`Invalid OpenAPI spec: ${(err as Error).message}`);
  }

  if (!isOpenApiV3Document(doc)) {
    throw new Error('Only OpenAPI 3.0 specs are supported. Swagger 2.0 is not supported.');
  }

  const title = doc.info.title;
  const version = doc.info.version;
  const baseUrl = doc.servers?.[0]?.url ?? '';

  const endpoints: ParsedEndpoint[] = [];

  if (doc.paths) {
    for (const [pathStr, pathItem] of Object.entries(doc.paths)) {
      if (!pathItem) continue;

      const pathItemRecord = pathItem as Record<string, unknown>;

      for (const key of Object.keys(pathItem)) {
        if (!isHttpMethod(key)) continue;

        const operation = pathItemRecord[key] as OpenAPIV3.OperationObject;
        if (!operation) continue;

        endpoints.push({
          method: key,
          path: pathStr,
          operationId: operation.operationId,
          summary: operation.summary,
          requestBodySchema: extractRequestBodySchema(operation),
          responseSchemas: extractResponseSchemas(operation),
          parameters: extractParameters(operation),
        });
      }
    }
  }

  return { title, version, baseUrl, endpoints };
}
