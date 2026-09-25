import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePostmanCollection } from '../postman-parser.js';
import { parseOpenApiSpec } from '../openapi-parser.js';

// Deterministic seed
fc.configureGlobal({ seed: 42, numRuns: 50 });

// ─── Constants ───────────────────────────────────────────────────────────────

const POSTMAN_V21_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const safeStr = fc.string({ minLength: 1, maxLength: 30 });

const postmanUrlArb = fc.record({
  raw: fc.oneof(
    fc.constant(undefined),
    fc.stringMatching(/^\/[a-z]{1,10}(\/[a-z]{1,10}){0,3}$/),
  ),
});

const postmanHeaderArb = fc.record({
  key: safeStr,
  value: safeStr,
});

const httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH');

// Leaf endpoint item (no sub-items)
const postmanEndpointItemArb = fc.record({
  name: fc.option(safeStr, { nil: undefined }),
  request: fc.record({
    method: httpMethodArb,
    url: postmanUrlArb,
    header: fc.array(postmanHeaderArb, { minLength: 0, maxLength: 3 }),
    body: fc.constant(undefined),
  }),
});

// A flat collection of endpoint items (depth-capped at 1 via letrec)
const postmanItemsArb = fc.letrec((tie) => ({
  item: fc.oneof(
    // leaf endpoint
    postmanEndpointItemArb,
    // folder with at most 2 nested endpoints
    fc.record({
      name: fc.option(safeStr, { nil: undefined }),
      item: fc.array(tie('item') as fc.Arbitrary<unknown>, { minLength: 1, maxLength: 2 }),
    }),
  ),
})).item as fc.Arbitrary<unknown>;

const postmanCollectionArb = fc.record({
  info: fc.record({
    name: safeStr,
    schema: fc.constant(POSTMAN_V21_SCHEMA),
  }),
  item: fc.array(postmanItemsArb, { minLength: 0, maxLength: 5 }),
});

// ─── parsePostmanCollection — property tests ─────────────────────────────────

describe('parsePostmanCollection — property tests', () => {
  it('valid v2.1 collections parse without throwing', () => {
    fc.assert(
      fc.property(postmanCollectionArb, (collection) => {
        parsePostmanCollection(JSON.stringify(collection));
      }),
    );
  });

  it('determinism: same JSON string always produces identical ParsedSpec', () => {
    fc.assert(
      fc.property(postmanCollectionArb, (collection) => {
        const json = JSON.stringify(collection);
        const result1 = parsePostmanCollection(json);
        const result2 = parsePostmanCollection(json);
        expect(result1).toEqual(result2);
      }),
    );
  });

  it('extra top-level fields do not crash the parser', () => {
    fc.assert(
      fc.property(
        postmanCollectionArb,
        fc.record({ extraField: safeStr, nested: fc.record({ x: fc.integer() }) }),
        (collection, extras) => {
          const withExtras = { ...collection, ...extras };
          parsePostmanCollection(JSON.stringify(withExtras));
        },
      ),
    );
  });

  it('endpoint count in result matches number of leaf request items', () => {
    // Use a fixed flat collection for count verification
    fc.assert(
      fc.property(
        fc.array(postmanEndpointItemArb, { minLength: 0, maxLength: 8 }),
        (items) => {
          const collection = {
            info: { name: 'Count Test', schema: POSTMAN_V21_SCHEMA },
            item: items,
          };
          const spec = parsePostmanCollection(JSON.stringify(collection));
          expect(spec.endpoints.length).toBe(items.length);
        },
      ),
    );
  });

  it('invalid JSON always throws an error', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        (invalidJson) => {
          expect(() => parsePostmanCollection(invalidJson)).toThrow();
        },
      ),
    );
  });

  it('wrong schema version always throws', () => {
    fc.assert(
      fc.property(
        postmanCollectionArb,
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s !== POSTMAN_V21_SCHEMA),
        (collection, wrongSchema) => {
          const modified = { ...collection, info: { ...collection.info, schema: wrongSchema } };
          expect(() => parsePostmanCollection(JSON.stringify(modified))).toThrow();
        },
      ),
    );
  });
});

// ─── Arbitraries for OpenAPI ──────────────────────────────────────────────────

const openApiPathSegmentArb = fc.stringMatching(/^\/[a-z]{2,8}$/);

const openApiOperationArb = fc.record({
  operationId: fc.option(safeStr, { nil: undefined }),
  summary: fc.option(safeStr, { nil: undefined }),
  responses: fc.constant({ '200': { description: 'OK' } }),
});

const openApiMethodArb = fc.constantFrom('get', 'post', 'put', 'delete', 'patch');

const openApiPathItemArb = fc.dictionary(
  openApiMethodArb,
  openApiOperationArb,
  { minKeys: 1, maxKeys: 3 },
);

const openApiPathsArb = fc.dictionary(
  openApiPathSegmentArb,
  openApiPathItemArb,
  { minKeys: 0, maxKeys: 5 },
);

const openApiSpecArb = openApiPathsArb.map((paths) => ({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths,
}));

// ─── parseOpenApiSpec — property tests ───────────────────────────────────────

describe('parseOpenApiSpec — property tests', () => {
  it('valid minimal OpenAPI 3.0 specs parse without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(openApiSpecArb, async (spec) => {
        await parseOpenApiSpec(JSON.stringify(spec));
      }),
    );
  });

  it('endpoint count in result matches total operations across all paths', async () => {
    await fc.assert(
      fc.asyncProperty(openApiSpecArb, async (spec) => {
        const totalOps = Object.values(spec.paths).reduce(
          (sum, pathItem) => sum + Object.keys(pathItem).length,
          0,
        );
        const result = await parseOpenApiSpec(JSON.stringify(spec));
        expect(result.endpoints.length).toBe(totalOps);
      }),
    );
  });

  it('missing openapi version field causes a parse error', async () => {
    await fc.assert(
      fc.asyncProperty(openApiSpecArb, async (spec) => {
        const { openapi: _openapi, ...withoutVersion } = spec;
        await expect(parseOpenApiSpec(JSON.stringify(withoutVersion))).rejects.toThrow();
      }),
    );
  });

  it('invalid JSON always rejects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        async (badJson) => {
          await expect(parseOpenApiSpec(badJson)).rejects.toThrow('Invalid JSON');
        },
      ),
    );
  });

  it('spec title and version are preserved in the parsed result', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: safeStr,
          version: fc.stringMatching(/^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}$/),
        }),
        async ({ title, version }) => {
          const spec = {
            openapi: '3.0.0',
            info: { title, version },
            paths: {},
          };
          const result = await parseOpenApiSpec(JSON.stringify(spec));
          expect(result.title).toBe(title);
          expect(result.version).toBe(version);
        },
      ),
    );
  });

  it('swagger 2.0 specs are rejected', async () => {
    const swagger2Spec = {
      swagger: '2.0',
      info: { title: 'Old API', version: '1.0.0' },
      paths: {},
      host: 'example.com',
      basePath: '/',
    };
    await expect(parseOpenApiSpec(JSON.stringify(swagger2Spec))).rejects.toThrow();
  });
});
