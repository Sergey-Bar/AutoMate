# @automate/shared-contracts

Shared contract types and validation schemas for the Automate unified platform.

## Overview

This package exports:

| Export                                                   | Purpose                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `TriggerRunRequestSchema`, `TriggerRunResponseSchema`, … | **Zod v4 schemas** — canonical validation source for TypeScript services |
| `TriggerRunRequest`, `TriggerRunResponse`, …             | **TypeScript types** inferred directly from schemas (not handwritten)    |
| `triggerRunRequestSchema`, `runResultCallbackSchema`, …  | **JSON Schema objects** for AJV consumers                                |

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

**There are currently no `*.schema.json` files in this package.** This section records
the strategy, not a shipped artefact.

<!-- review:no-test prose only - this corrects two claims about the tree and ships no
     runtime behaviour, so there is nothing for a test to exercise. -->

`ajv` is a devDependency and `zod.test.ts` compiles the Zod schemas, but nothing reads a
JSON Schema file: `git ls-files packages/shared-contracts` returns only `.ts` sources, and
`src/schemas/` holds no `.schema.json`. An earlier version of this README described those
files as "preserved for backward compatibility" and instructed the reader to update them
alongside `zod.ts`. Both sentences were false, and nothing checked them — a claim about the
state of the tree that only a human running `git ls-files` can settle.

### Canonical source of truth

**Zod v4 schemas** (in `src/schemas/zod.ts`) are the **authoritative contract definition**
for all TypeScript services. TypeScript types are inferred from schemas — there are no
manually maintained interface files.

### If JSON Schema output is ever needed

| Need                              | Status                                                               |
| --------------------------------- | -------------------------------------------------------------------- |
| Runtime validation in TypeScript  | Zod v4 (`safeParse`) — **shipped**                                   |
| OpenAPI document                  | **Not shipped.** No generator dependency, no artifact, no drift gate |
| AJV validation of raw JSON Schema | **Not shipped.** `ajv` is installed and unused                       |

The OpenAPI gap is tracked in `docs/quality/findings-ledger.json`. Two claims about it were
corrected against the tree on 2026-10-02: this README is the only document in the
repository that mentions OpenAPI at all, and there is **no** `@asteasolutions/zod-to-openapi`
dependency — `package.json` lists `zod` as its only runtime dependency.

### Keeping one source

When a contract changes, the only step is:

1. **Update `src/schemas/zod.ts`** — this is the source of truth.
2. The contract tests in `src/schemas/zod.test.ts` will catch invalid payloads.

If a generated artefact is ever added, it must be **generated** in a script and **checked**
in a gate. A generated file that no gate compares against the schema drifts silently, which
is worse than having no artefact at all: it reads as a specification and is not enforced.

> **Note:** auto-generation via `zod-to-json-schema` or `@asteasolutions/zod-to-openapi` is a
> future step, not a present capability. Whichever is chosen, the drift gate is the
> load-bearing half and the generator is the cheap one.

---

## Contracts

| Contract              | Required fields                                                                                                    | Optional fields                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `TriggerRunRequest`   | `specCode`, `specFileName`                                                                                         | `baseUrl`, `browser`, `metadata` |
| `TriggerRunResponse`  | `runId`, `status`                                                                                                  | —                                |
| `RunResultCallback`   | `runId`, `status`, `duration`, `total`, `passed`, `failed`, `skipped`, `triggeredBy`, `triggeredAt`, `completedAt` | `errors`                         |
| `ServiceHealthStatus` | `status`                                                                                                           | `version`, `uptime`, `checks`    |
| `UnifiedAuthToken`    | `valid`                                                                                                            | `userId`, `expiresAt`            |

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
