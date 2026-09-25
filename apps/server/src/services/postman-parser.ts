import { z } from 'zod/v4';
import type { ParsedSpec, ParsedEndpoint, ParsedParameter } from './openapi-parser.js';

// Re-export so consumers can use this module as a single source
export type { ParsedSpec, ParsedEndpoint, ParsedParameter };

// ─── Zod schemas ────────────────────────────────────────────────────────────

const PostmanUrlSchema = z.object({
  raw: z.string().optional(),
  path: z.array(z.string()).optional(),
}).passthrough();

const PostmanHeaderSchema = z.object({
  key: z.string(),
  value: z.string(),
}).passthrough();

const PostmanBodySchema = z.object({
  mode: z.string().optional(),
  raw: z.string().optional(),
}).passthrough().nullable().optional();

const PostmanRequestSchema = z.object({
  method: z.string(),
  url: PostmanUrlSchema.optional(),
  header: z.array(PostmanHeaderSchema).optional(),
  body: PostmanBodySchema,
}).passthrough();

// Postman items can be folders (with `item`) or endpoints (with `request`).
// We use z.lazy for the recursive folder structure.
type PostmanItem = {
  name?: string;
  request?: z.infer<typeof PostmanRequestSchema>;
  item?: PostmanItem[];
};

const PostmanItemSchema: z.ZodType<PostmanItem> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    request: PostmanRequestSchema.optional(),
    item: z.array(PostmanItemSchema).optional(),
  }).passthrough(),
);

const PostmanCollectionSchema = z.object({
  info: z.object({
    name: z.string(),
    schema: z.string(),
    version: z.string().optional(),
  }),
  item: z.array(z.unknown()),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const POSTMAN_V21_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

function resolveUrl(url: z.infer<typeof PostmanUrlSchema> | undefined): string {
  if (!url) return '';
  if (url.raw) return url.raw;
  if (url.path && url.path.length > 0) return '/' + url.path.join('/');
  return '';
}

function parseBodySchema(body: z.infer<typeof PostmanBodySchema>): Record<string, unknown> | undefined {
  if (!body) return undefined;
  if (body.mode !== 'raw' || !body.raw) return undefined;
  try {
    const parsed = JSON.parse(body.raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch (_err: unknown) {
    // Best-effort JSON parsing — body may contain non-JSON raw text
    return undefined;
  }
}

function parseHeaders(headers: Array<z.infer<typeof PostmanHeaderSchema>> | undefined): ParsedParameter[] {
  if (!headers || headers.length === 0) return [];
  return headers.map((h) => ({
    name: h.key,
    in: 'header',
    required: false,
    schema: { type: 'string', example: h.value },
  }));
}

/**
 * Recursively flatten Postman items into a list of endpoint-bearing items.
 * Items with an `item` sub-array are folders; items with `request` are endpoints.
 */
function flattenItems(rawItems: unknown[]): z.infer<typeof PostmanItemSchema>[] {
  const result: z.infer<typeof PostmanItemSchema>[] = [];
  for (const rawItem of rawItems) {
    const parsed = PostmanItemSchema.safeParse(rawItem);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (Array.isArray(item.item) && item.item.length > 0) {
      // Folder — recurse
      result.push(...flattenItems(item.item));
    } else if (item.request) {
      result.push(item);
    }
  }
  return result;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a Postman v2.1 collection JSON string into a `ParsedSpec`.
 * Throws `Error` for invalid JSON or non-v2.1 schema.
 */
export function parsePostmanCollection(collectionJson: string): ParsedSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(collectionJson);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  const result = PostmanCollectionSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid Postman collection: ${result.error.message}`);
  }

  const collection = result.data;

  if (collection.info.schema !== POSTMAN_V21_SCHEMA) {
    throw new Error(
      `Unsupported Postman schema: "${collection.info.schema}". Only v2.1 is supported.`,
    );
  }

  const title = collection.info.name;
  const version = collection.info.version ?? '1.0';
  const baseUrl = '';

  const flatItems = flattenItems(collection.item);

  const endpoints: ParsedEndpoint[] = flatItems.map((item) => {
    const req = item.request!;
    const method = req.method.toLowerCase();
    const path = resolveUrl(req.url);
    const parameters = parseHeaders(req.header);
    const requestBodySchema = parseBodySchema(req.body);

    return {
      method,
      path,
      operationId: undefined,
      summary: item.name,
      requestBodySchema,
      responseSchemas: {},
      parameters,
    };
  });

  return { title, version, baseUrl, endpoints };
}
