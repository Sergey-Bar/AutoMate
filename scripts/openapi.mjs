#!/usr/bin/env node
/**
 * `pnpm openapi` — the OpenAPI document, generated from the one authority for
 * which paths this product serves.
 *
 * ## What this is not
 *
 * It is not a hand-written description.
 *
 * Every route comes from `apps/api/src/route-manifest.ts`, which
 * `route-manifest.test.ts` in that package proves equal to the set of routes the
 * mounted app actually registers — in both directions, and with no
 * `(method, path)` registered twice. So a path in this document is a path the
 * product serves, or the test that proves it is failing.
 *
 * Every response status comes from `docs/quality/authz-matrix.json`, which is
 * *recorded* by `apps/api/src/routes/authz-matrix.test.ts` against the running
 * app. That is what keeps the `responses` blocks honest: they are measured, not
 * asserted, so a route that starts answering 500 makes this document describe a
 * route that answers 500 — and the matrix's own gate fails first.
 *
 * Every request body comes from `z.toJSONSchema` over the Zod schema the route
 * actually validates with. A hand-written JSON Schema for a body would be a second
 * authority for the same contract, and the two drift; a derived one cannot drift
 * from the schema it is derived from.
 *
 * ## Why `.mjs` and not a TypeScript generator
 *
 * Two reasons, and the second is the real one.
 *
 * **The gate chain is `.mjs`.** `AGENTS.md` records it: gate scripts in `scripts/`
 * are plain `.mjs` with JSDoc types, typechecked by `tsconfig.scripts.json`, because
 * "a gate script that is excluded from type checking is a gate script whose wrong
 * argument count nothing catches". A `.ts` generator in `scripts/` would sit outside
 * that typecheck and outside the convention, and it would need a build step to run.
 *
 * **So each schema is imported by path, with Node's type stripping.** Node 24 loads
 * a `.ts` file directly, which is what makes `z.toJSONSchema` reachable from a
 * build-free gate. That works only for modules whose own imports resolve — and not
 * all of them do: `packages/shared-contracts/src/schemas/run-command.ts` imports
 * `./qa-score.js` with the extension rewrite TypeScript performs and type-stripping
 * does not, so importing it fails. `REQUEST_BODIES` therefore names the module each
 * route really validates against, and a route whose body cannot be reached that way
 * is declared `null` with its reason recorded. A `null` is a claim this generator
 * checks rather than a gap it leaves: see `assertBodyCoverage`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalRoutes, pathParameters } from './lib/route-manifest.mjs';

const root = path.resolve(import.meta.dirname, '..');

/** Where the generated artefact is committed. */
export const OPENAPI_PATH = 'docs/api/openapi.json';

/** Where the measured answer classes live, and why they are the `responses`. */
const MATRIX_PATH = 'docs/quality/authz-matrix.json';

/** The route bodies, and the module each one is declared in. */
const EXECUTION_SCHEMAS = 'apps/api/src/routes/execution/schemas.ts';
const AGENT_SCHEMAS = 'packages/shared-contracts/src/schemas/agents.ts';

/**
 * The request bodies the product validates, by route key.
 *
 * One entry per canonical route whose method conventionally carries a body —
 * every `POST` and every `PATCH` — and `assertBodyCoverage` is what makes that list
 * complete rather than aspirational. A route absent from here fails the generator,
 * so adding a route forces the decision to be made in a line a reviewer reads.
 *
 * A value of `null` says the body is not reachable from a build-free `.mjs` gate, and
 * `BODY_OWNERS` records why. Three distinct reasons appear there, and they are not
 * the same reason wearing three hats:
 *
 *  1. **`null` with no schema at all.** The handler reads the body by hand, so there
 *     is nothing to derive a document from. That is a finding about the route, not
 *     about this generator.
 *  2. **`null` because the schema module will not import.** The route's contract is
 *     in shared-contracts but the module's own imports do not resolve under Node's
 *     type stripping.
 *  3. **`null` because the route validates a derived variant.** `Schema.omit({ id })`
 *     is not the named export, and describing the un-omitted shape would document a
 *     body the route does not accept.
 *
 * @type {Record<string, readonly [string, string] | null>}
 */
const REQUEST_BODIES = {
  'POST /api/v1/auth/login': null,
  'POST /api/v1/auth/logout': null,
  'POST /api/v1/reporter/events': [EXECUTION_SCHEMAS, 'EventSchema'],
  'POST /api/v1/reporter/upload': null,
  'POST /api/v1/reporter/results': null,
  'POST /api/v1/runs': [EXECUTION_SCHEMAS, 'CreateRunSchema'],
  'POST /api/v1/runs/:runId/cancel': null,
  'POST /api/v1/runs/:runId/retry': null,
  'POST /api/v1/quality-policies': [EXECUTION_SCHEMAS, 'PolicySchema'],
  'POST /api/v1/runners/register': [EXECUTION_SCHEMAS, 'RegistrationSchema'],
  'POST /api/v1/runners/:runnerId/heartbeat': [EXECUTION_SCHEMAS, 'HeartbeatSchema'],
  'POST /api/v1/runners/:runnerId/jobs/claim': [EXECUTION_SCHEMAS, 'ClaimSchema'],
  'POST /api/v1/jobs/:jobId/events': [EXECUTION_SCHEMAS, 'EventSchema'],
  'POST /api/v1/jobs/:jobId/events/batch': [EXECUTION_SCHEMAS, 'EventBatchSchema'],
  'POST /api/v1/jobs/:jobId/artifacts': [EXECUTION_SCHEMAS, 'ArtifactSchema'],
  'POST /api/v1/jobs/:jobId/complete': [EXECUTION_SCHEMAS, 'CompleteSchema'],
  'POST /api/v1/agents/:domain/:action': [AGENT_SCHEMAS, 'AgentRequestSchema'],
  'POST /api/v1/chat/completions': null,
  'PATCH /api/v1/dashboard/runs/:id/status': null,
  'POST /api/v1/dashboard/quarantine': null,
  'PATCH /api/v1/dashboard/quarantine/:id': null,
  'POST /api/v1/dashboard/quality-gates': null,
  'POST /api/v1/projects': null,
  'PATCH /api/v1/projects/:id': null,
  'POST /api/v1/projects/:id/decisions': null,
  'POST /api/v1/projects/:id/detect': null,
  'POST /api/v1/projects/:id/run.start': null,
  'POST /api/v1/runs/:runId/stop': null,
  'POST /api/v1/projects/:id/copilot/answer': null,
  'POST /api/v1/runner/v1/enroll': null,
  'POST /api/v1/runner/v1/sync': null,
  'POST /api/v1/runner/v1/jobs/:jobId/events/batch': null,
  'POST /api/v1/automations': null,
  'POST /api/v1/schedules': null,
  'POST /api/v1/automations/:id/jobs': null,
  'POST /api/v1/jobs/:id/cancel': null,
};

/**
 * Why each `null` is `null`, as a fact about where the schema is.
 *
 * @type {Record<string, string>}
 */
const BODY_OWNERS = {
  'POST /api/v1/auth/login':
    'The login body is validated by a schema local to `apps/api/src/routes/auth.ts`, which ' +
    'owns the cookie and session vocabulary this API enforces. `auth.ts` in shared-contracts ' +
    'exports a session and a bearer-token schema, not the credential pair a login carries.',
  'POST /api/v1/auth/logout': 'No body: the route reads the session cookie and nothing else.',
  'POST /api/v1/reporter/upload':
    'A multipart form the API parses with its own local schema, because the upload boundary ' +
    'is infrastructure this package does not model and multipart is not JSON.',
  'POST /api/v1/reporter/results':
    'A local schema in `apps/api/src/routes/reporter-results.ts`. `CanonicalRunResultSchema` ' +
    'in shared-contracts is the *result* vocabulary, not the upload envelope, and describing ' +
    'one for the other is the failure this table exists to prevent.',
  'POST /api/v1/runs/:runId/cancel': 'No body: the run id is the whole request.',
  'POST /api/v1/runs/:runId/retry':
    'No body: the run id and the idempotency key are the whole request.',
  'POST /api/v1/chat/completions':
    'A local schema in `apps/api/src/routes/chat.ts`, because it is the provider-neutral ' +
    'request the gateway adapters consume and shared-contracts owns only the message and ' +
    'stream-event halves of it.',
  'PATCH /api/v1/dashboard/runs/:id/status':
    'A local schema in `apps/api/src/modules/dashboard/runs.ts`.',
  'POST /api/v1/dashboard/quarantine':
    'A local schema in `apps/api/src/modules/dashboard/quarantine.ts`.',
  'PATCH /api/v1/dashboard/quarantine/:id':
    'A local schema in `apps/api/src/modules/dashboard/quarantine.ts`.',
  'POST /api/v1/dashboard/quality-gates':
    'A local schema in `apps/api/src/modules/dashboard/quality-gates.ts`.',
  'POST /api/v1/projects':
    'A local schema in `apps/api/src/routes/projects.ts`, which owns the registration ' +
    'vocabulary the project registry enforces.',
  'PATCH /api/v1/projects/:id':
    'A local schema published by `@automate/projects`, which owns the profile shape and is ' +
    'not reachable from a build-free gate here.',
  'POST /api/v1/projects/:id/decisions':
    "**The handler reads the body by hand** — `input['findingId']`, `input['verdict']` and " +
    'four siblings, with no Zod schema anywhere on the path. There is nothing to derive a ' +
    'document from, and `DECISION_VERDICTS` in `@automate/db` — the vocabulary the decision ' +
    'store enforces on write — is not consulted either. This null is a finding about the ' +
    'route, not a limitation of this generator: the route that records a verdict has no ' +
    'contract for the verdict.',
  'POST /api/v1/projects/:id/detect':
    'No body: the project id and the detector name are the whole request.',
  'POST /api/v1/projects/:id/run.start':
    'The route validates `RunStartBodySchema` from shared-contracts, but it is exported from ' +
    "`run-command.ts`, which imports `./qa-score.js` and so cannot be loaded under Node's " +
    "type stripping. Filling this in needs the module's own imports fixed, not a copy.",
  'POST /api/v1/runs/:runId/stop':
    'The same `run-command.ts` module as run.start, for the same reason.',
  'POST /api/v1/projects/:id/copilot/answer':
    'The same `run-command.ts` module, which is where `CopilotQuestionSchema` lives. The ' +
    'reason records the constraint rather than hiding it: a body that cannot be imported ' +
    'is a body that cannot be derived, and a hand-written copy of it would be a second ' +
    'authority for the question being asked.',
  'POST /api/v1/runner/v1/enroll':
    'A local schema in `apps/api/src/routes/runner.ts`, which owns the legacy ' +
    'process-local enrolment vocabulary.',
  'POST /api/v1/runner/v1/sync': 'No body: the runner control plane reads its own state.',
  'POST /api/v1/runner/v1/jobs/:jobId/events/batch':
    'A local schema in `apps/api/src/routes/runner.ts`.',
  'POST /api/v1/automations':
    'The route validates `AutomationDefinitionSchema.omit({ id: true })`. The named export is ' +
    'not what the route accepts — it carries an `id` the route rejects on create — so ' +
    'deriving from it would document a body the product refuses.',
  'POST /api/v1/schedules':
    'The same `.omit({ id: true })` variant as automations, for the same reason.',
  'POST /api/v1/automations/:id/jobs':
    'No body: the automation id and the command are the whole request.',
  'POST /api/v1/jobs/:id/cancel': 'No body: the job id is the whole request.',
};

/** The methods whose route conventionally carries a request body. */
const BODY_METHODS = new Set(['POST', 'PATCH']);

/** @param {string} relative @returns {string} */
function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

/**
 * The JSON Schema for one request body, derived from the schema the route uses.
 *
 * @param {readonly [string, string]} entry the module, relative to the root, and the export
 * @param {string} key the route key, for the error message only
 * @returns {Promise<object>}
 */
async function jsonSchemaFor(entry, key) {
  const [module, exportName] = entry;
  const modulePath = path.join(root, module);
  let loaded;
  try {
    loaded = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    throw new Error(
      `${key} maps to ${exportName} from ${module}, which cannot be imported: ` +
        `${error instanceof Error ? error.message : String(error)}. Either the module moved, or ` +
        'its own imports do not resolve under Node type-stripping — declare the route null ' +
        'with its reason rather than leaving a mapping that fails at generation time.',
      // The import failure is the evidence for this one, and the ESLint rule wants
      // it preserved rather than replaced by a message about the message.
      { cause: error },
    );
  }
  const schema = /** @type {{ toJSONSchema?: () => object } | undefined} */ (
    loaded[/** @type {string} */ (exportName)]
  );
  if (schema === undefined || typeof schema.toJSONSchema !== 'function') {
    throw new Error(
      `${key} maps to ${exportName} from ${module}, but that module exports no such schema. ` +
        'The mapping is wrong, and a wrong mapping produces a document that describes a ' +
        'contract the product does not have.',
    );
  }
  return schema.toJSONSchema();
}

/**
 * Every body-carrying route has an entry, and only body-carrying routes do.
 *
 * This is the assertion that makes the table complete rather than aspirational.
 * Without it a new `POST` would be silently absent from the document and the document
 * would still report success — the same failure as a gate that passes on nothing.
 *
 * @returns {void}
 */
function assertBodyCoverage() {
  const canonical = canonicalRoutes();
  const keys = new Set(canonical.map(({ method, path: routePath }) => `${method} ${routePath}`));
  const table = new Set(Object.keys(REQUEST_BODIES));

  const missing = canonical
    .filter(({ method }) => BODY_METHODS.has(method))
    .map(({ method, path: routePath }) => `${method} ${routePath}`)
    .filter((key) => !table.has(key));
  if (missing.length > 0) {
    throw new Error(
      `${String(missing.length)} body-carrying route(s) have no entry in REQUEST_BODIES: ` +
        `${missing.join(', ')}. A route absent from the document is a surface nothing ` +
        'describes; add an entry, or a null with a reason in BODY_OWNERS.',
    );
  }

  const extra = [...table].filter((key) => !keys.has(key));
  if (extra.length > 0) {
    throw new Error(
      `REQUEST_BODIES declares ${String(extra.length)} route(s) the manifest does not: ` +
        `${extra.join(', ')}. A body describing a route the product no longer serves is a false claim.`,
    );
  }

  // A null with no reason is a hole in the document that reads like a decision.
  const unexplained = [...table].filter(
    (key) => REQUEST_BODIES[key] === null && !(key in BODY_OWNERS),
  );
  if (unexplained.length > 0) {
    throw new Error(
      `${String(unexplained.length)} null entry has no reason in BODY_OWNERS: ${unexplained.join(', ')}.`,
    );
  }
}

/**
 * The answer a route is recorded as giving, as a `responses` block.
 *
 * Only the measured status is emitted. A hand-written `400` beside a measured `200`
 * would be a claim the artefact does not support, and a route that answers two ways is
 * a route the matrix has not been asked about twice — which is the next thing this
 * document should grow, not a thing to invent here.
 *
 * @param {{ status: number, className: string } | undefined} observed
 * @returns {object}
 */
function responsesFor(observed) {
  if (observed === undefined) return { default: { description: 'Not recorded' } };
  return {
    [String(observed.status)]: {
      description: `Recorded by the authz matrix as ${observed.className}.`,
    },
  };
}

/** @param {string} method @param {string} routePath @returns {string} */
function toOperationId(method, routePath) {
  const tail = routePath
    .split('/')
    .filter((segment) => segment !== '' && !segment.startsWith(':'))
    .join('-')
    .replaceAll('.', '-');
  return `${method.toLowerCase()}-${tail}`;
}

/**
 * Derives the component name a request body's schema is filed under.
 *
 * The name is the schema's export name rather than the route key, so two routes
 * validating the same body share one component — `POST /api/v1/jobs/:jobId/events`
 * and `POST /api/v1/reporter/events` both answer `EventSchema`, and a document with
 * two copies of the same object is a document whose two copies can drift.
 *
 * @param {string} exportName
 * @returns {string}
 */
function toSlug(exportName) {
  return exportName
    .replaceAll(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** @returns {Promise<object>} */
async function buildDocument() {
  const matrix =
    /** @type {{ rows?: Array<{ method: string, path: string, status: number, className: string }> }} */ (
      JSON.parse(read(MATRIX_PATH))
    );
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const byKey = new Map(rows.map((row) => [`${row.method} ${row.path}`, row]));
  const packageJson = JSON.parse(read('package.json'));

  /** @type {Record<string, object>} */
  const paths = {};
  /** @type {Record<string, object>} */
  const schemas = {};

  for (const { method, path: routePath } of canonicalRoutes()) {
    const key = `${method} ${routePath}`;
    const observed = byKey.get(key);
    const body = REQUEST_BODIES[key];
    /** @type {Record<string, unknown>} */
    const operation = {
      operationId: toOperationId(method, routePath),
      // The one thing a reader of the document cannot derive from anything but the
      // measurement, prefixed so nobody mistakes it for a hand-written promise.
      description:
        observed === undefined
          ? 'No recorded answer. The authz matrix has no row for this route.'
          : `Recorded answer: ${String(observed.status)} (${observed.className}). Measured by ` +
            '`apps/api/src/routes/authz-matrix.test.ts`, not asserted by this document.',
      parameters: pathParameters(routePath).map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      responses: responsesFor(observed),
    };
    if (body !== undefined && body !== null) {
      const exportName = body[1];
      const reference = `#/components/schemas/${toSlug(exportName)}`;
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: { $ref: reference } } },
      };
      schemas[toSlug(exportName)] = await jsonSchemaFor(body, key);
    }
    if (body === null && BODY_OWNERS[key] !== undefined) {
      // The reason a body is absent is part of the document. An OpenAPI reader has
      // no other way to tell "this route takes nothing" from "this route takes
      // something nobody could describe".
      operation.description += ` No machine-checked request body: ${BODY_OWNERS[key]}`;
    }
    const forPath = /** @type {Record<string, unknown>} */ (paths[routePath] ?? {});
    forPath[method.toLowerCase()] = operation;
    paths[routePath] = forPath;
  }

  const document = {
    openapi: '3.1.0',
    info: {
      title: 'Automate API',
      version: typeof packageJson.version === 'string' ? packageJson.version : '0.0.0',
      description:
        'Generated. Paths from `apps/api/src/route-manifest.ts`, responses from the recorded ' +
        'authz matrix, request bodies from `z.toJSONSchema` over the Zod schema each route ' +
        'validates with. Regenerate with `pnpm openapi`; `pnpm docs:check` fails on drift.',
    },
    servers: [{ url: '/' }],
    paths,
    components: { schemas },
  };
  return document;
}

/**
 * The output path, from `--out <path>` or `--out=<path>`.
 *
 * Both forms, because the staleness check passes the `=` form and a person typing
 * the command types the space form. Parsing only the space form was the first
 * version's bug, and it was a dangerous one: the check then fell through to
 * `OPENAPI_PATH`, so the run it believed was writing to a temporary file was
 * rewriting the artefact it was about to compare — the exact failure the
 * generated-pages check warns about, reintroduced by an argument parser.
 *
 * @returns {string}
 */
function outputPath() {
  const flagIndex = process.argv.findIndex((argument) => argument === '--out');
  if (flagIndex !== -1) {
    const separate = process.argv[flagIndex + 1];
    if (separate === undefined || separate.startsWith('--')) {
      throw new Error(
        '`--out` was given no path. The generator never writes to the committed path unless it is given it.',
      );
    }
    return path.resolve(process.cwd(), separate);
  }
  const inline = process.argv.find((argument) => argument.startsWith('--out='));
  if (inline !== undefined) {
    const value = inline.slice('--out='.length);
    if (value === '') throw new Error('`--out=` was given no path.');
    return path.resolve(process.cwd(), value);
  }
  return path.join(root, OPENAPI_PATH);
}

/** @returns {Promise<void>} */
async function main() {
  const output = outputPath();
  // The coverage assertion runs before anything is written, so a failing generator
  // leaves no half-written document behind.
  assertBodyCoverage();
  const document = await buildDocument();
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${path.relative(root, output)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
