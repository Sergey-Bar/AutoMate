# @automate/shared-contracts

Shared contract types and validation schemas for the Automate unified platform.

## Overview

This package exports:

| Export | Purpose |
|---|---|
| `TriggerRunRequestSchema`, `TriggerRunResponseSchema`, … | **Zod v4 schemas** — canonical validation source for TypeScript services |
| `TriggerRunRequest`, `TriggerRunResponse`, … | **TypeScript types** inferred directly from schemas (not handwritten) |
| `triggerRunRequestSchema`, `runResultCallbackSchema`, … | **JSON Schema objects** for AJV consumers |

## Usage

### TypeScript / Zod validation

```ts
import { TriggerRunRequestSchema } from '@automate/shared-contracts';

const result = TriggerRunRequestSchema.safeParse(body);
if (!result.success) {
  // result.error.issues contains field-level errors
}
const payload = result.data; // typed as TriggerRunRequest
```

### Type-only imports

```ts
import type { TriggerRunRequest, RunResultCallback } from '@automate/shared-contracts';
```

### AJV / JSON Schema consumers

```ts
import Ajv from 'ajv';
import { triggerRunRequestSchema } from '@automate/shared-contracts';

const ajv = new Ajv();
const validate = ajv.compile(triggerRunRequestSchema);
```

---

## JSON Schema / AJV Compatibility Strategy

The `*.schema.json` files in `src/schemas/` are **preserved for backward compatibility** with AJV consumers and for any tooling that generates documentation, mocks, or OpenAPI specs from JSON Schema.

### Canonical source of truth

**Zod v4 schemas** (in `src/schemas/zod.ts`) are the **authoritative contract definition** for all TypeScript services. TypeScript types are inferred from schemas — there are no manually maintained interface files.

### Why both?

| Need | Solution |
|---|---|
| Runtime validation in TypeScript | Zod v4 (`safeParse`) |
| Fastify schema validation / serialisation (AJV) | JSON Schema objects (`triggerRunRequestSchema`) |
| OpenAPI doc generation | JSON Schema objects |
| Test data generation / mocking | Either |

### Keeping them in sync

When a contract changes:
1. **Update `src/schemas/zod.ts`** — this is the source of truth.
2. **Update the corresponding `*.schema.json`** to match (they must stay structurally identical).
3. The contract tests in `src/schemas/zod.test.ts` will catch invalid payloads.

> **Note:** A future migration step will auto-generate JSON Schemas from the Zod schemas using
> `zod-to-json-schema`, eliminating the manual sync requirement.

---

## Contracts

| Contract | Required fields | Optional fields |
|---|---|---|
| `TriggerRunRequest` | `specCode`, `specFileName` | `baseUrl`, `browser`, `metadata` |
| `TriggerRunResponse` | `runId`, `status` | — |
| `RunResultCallback` | `runId`, `status`, `duration`, `total`, `passed`, `failed`, `skipped`, `triggeredBy`, `triggeredAt`, `completedAt` | `errors` |
| `ServiceHealthStatus` | `status` | `version`, `uptime`, `checks` |
| `UnifiedAuthToken` | `valid` | `userId`, `expiresAt` |

---

## Development

```bash
# Run tests
pnpm --filter @automate/shared-contracts test

# Build
pnpm --filter @automate/shared-contracts build

# Type-check
pnpm --filter @automate/shared-contracts exec tsc --noEmit
```
