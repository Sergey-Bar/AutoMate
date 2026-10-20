import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import * as contracts from './index.js';
import { buildComponentSchemas } from './openapi.js';

/**
 * The schema half of the OpenAPI drift gate (ledger RF-11). The route half is
 * `scripts/lib/openapi-drift.test.mjs`. This one lives in the package because it needs the
 * contracts, and `pnpm test` runs it from source, so it does not depend on a build.
 */
const committed = JSON.parse(
  readFileSync(new URL('../../../docs/openapi.json', import.meta.url), 'utf8'),
) as { components: { schemas: Record<string, unknown> } };

describe('the OpenAPI components', () => {
  const generated = buildComponentSchemas(contracts);

  it('are exactly what docs/openapi.json holds', () => {
    expect(
      committed.components.schemas,
      'docs/openapi.json is stale; run `pnpm build` then `pnpm openapi:generate`',
    ).toEqual(generated);
  });

  it('cover every Zod schema the package exports, and there are many', () => {
    const exported = Object.entries(contracts).filter(
      ([, value]) => typeof (value as { safeParse?: unknown }).safeParse === 'function',
    );
    expect(exported.length).toBeGreaterThan(100);
    for (const [name] of exported) expect(generated).toHaveProperty([name]);
  });

  it('only point at components that exist', () => {
    const missing: string[] = [];
    JSON.stringify(generated, (key, value: unknown) => {
      if (key === '$ref' && typeof value === 'string') {
        const target = value.replace('#/components/schemas/', '');
        if (!value.startsWith('#/components/schemas/') || !(target in generated)) {
          missing.push(value);
        }
      }
      return value;
    });
    expect(missing).toEqual([]);
  });

  it('lift a schema-local definition into a component of its own', () => {
    expect(generated).toHaveProperty(['CanonicalRunResultSchema.__schema0']);
    expect(JSON.stringify(generated['CanonicalRunResultSchema'])).not.toContain('#/$defs/');
  });

  it('skip exports that are not schemas and survive one with no JSON form', () => {
    const built = buildComponentSchemas({
      NotASchema: 42,
      AlsoNot: { safeParse: 'no' },
      Odd: z.string().transform((value) => value.length),
      Plain: z.object({ id: z.string() }),
    });
    expect(Object.keys(built)).toEqual(['Odd', 'Plain']);
    expect(built['Plain']).toMatchObject({ type: 'object', required: ['id'] });
  });
});
