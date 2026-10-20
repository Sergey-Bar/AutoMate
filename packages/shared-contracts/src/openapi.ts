import { z } from 'zod/v4';

/** A JSON Schema document as `z.toJSONSchema` returns it. */
type JsonSchema = Record<string, unknown>;

const DEFS_PREFIX = '#/$defs/';
const COMPONENT_PREFIX = '#/components/schemas/';

function isZodSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

/**
 * Re-point `#/$defs/x` references at the component that `hoist` gave the definition.
 *
 * A definition local to one schema is no use in an OpenAPI document, where `#` is the whole
 * document and not the schema, so each one is lifted to `components.schemas` under the name
 * `<Schema>.<definition>` and every reference to it is rewritten to match.
 */
function rewriteReferences(node: unknown, owner: string): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteReferences(item, owner));
  if (typeof node !== 'object' || node === null) return node;
  const rewritten: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    rewritten[key] =
      key === '$ref' && typeof value === 'string' && value.startsWith(DEFS_PREFIX)
        ? `${COMPONENT_PREFIX}${owner}.${value.slice(DEFS_PREFIX.length)}`
        : rewriteReferences(value, owner);
  }
  return rewritten;
}

/**
 * Every Zod schema in `contracts`, as an OpenAPI `components.schemas` map, keyed by its export
 * name and sorted by it so the output is stable.
 *
 * `contracts` is passed in rather than imported because this module is itself re-exported from
 * the package index: importing the index back would be a cycle. Callers pass
 * `import * as contracts from './index.js'`.
 *
 * `unrepresentable: 'any'` makes a schema with no JSON form (a transform, a custom check)
 * accept anything instead of throwing, so one such schema does not stop the document being
 * generated. It is the loose reading, which is the right one for a description of what the API
 * will accept.
 */
export function buildComponentSchemas(
  contracts: Record<string, unknown>,
): Record<string, JsonSchema> {
  const components: Record<string, JsonSchema> = {};
  for (const name of Object.keys(contracts).sort()) {
    const schema = contracts[name];
    if (!isZodSchema(schema)) continue;
    const {
      $schema: _dialect,
      $defs: definitions,
      ...body
    } = z.toJSONSchema(schema, {
      unrepresentable: 'any',
    }) as JsonSchema & { $defs?: Record<string, JsonSchema> };
    components[name] = rewriteReferences(body, name) as JsonSchema;
    for (const [definition, value] of Object.entries(definitions ?? {})) {
      components[`${name}.${definition}`] = rewriteReferences(value, name) as JsonSchema;
    }
  }
  return components;
}
