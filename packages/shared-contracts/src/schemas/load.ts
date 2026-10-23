import { z } from 'zod/v4';
import { isPlainHttpUrl } from './agents.js';

/**
 * load.run  (ledger X-3 / BK-1: the load domain)
 *
 * The ceilings live here, in the contract, because two places must agree on them and neither
 * may be able to raise them alone: the API refuses a request above them (`LoadRunInputSchema`)
 * and the runner refuses a job above them (`LoadJobConfigurationSchema`) even if a row was
 * written by something else. They are the hard bound on how much load one run can generate -
 * k6 is a load generator, so an unbounded `vus` or `duration` is a denial-of-service tool.
 */
export const LOAD_MAX_VUS = 50;
export const LOAD_MAX_DURATION_SECONDS = 300;
export const LOAD_DEFAULT_VUS = 1;
export const LOAD_DEFAULT_DURATION_SECONDS = 30;

/**
 * A script is named, never supplied: a path *relative to the runner's configured script root*
 * (`RUNNER_K6_SCRIPT_ROOT`), in `/`-separated segments that each start with a letter or digit.
 * That one rule excludes `..`, `.`, a leading `/`, a drive letter, a backslash and a leading
 * `-` (which could be read as a CLI flag) without a second check to keep in step.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Segment-wise, so no single pattern has to express "a path" (and none can backtrack). */
function isScriptPath(value: string): boolean {
  return value.endsWith('.js') && value.split('/').every((segment) => SEGMENT.test(segment));
}

const scriptPath = z
  .string()
  .max(200)
  .refine(isScriptPath, 'must be a relative .js path inside the script root');

const vus = z.number().int().min(1).max(LOAD_MAX_VUS);
const durationSeconds = z.number().int().min(1).max(LOAD_MAX_DURATION_SECONDS);

/**
 * Input of `POST /api/v1/agents/load/run`.
 *
 * Strict, and deliberately not a k6 command line: there is no `args`, no `command`, no `env`,
 * no `out`, no timeout. The runner builds the argv itself from these fields. Thresholds are
 * not overridable from outside either - k6 has no flag for them, they live in the script
 * (`export const options.thresholds`), and they are what decides pass or fail.
 *
 * - `targetUrl` is handed to the script as `TARGET_URL`; only its shape is checked here (http
 *   or https, no credentials). The runner enforces `RUNNER_ALLOWED_TARGET_URLS`, and a target
 *   it refuses becomes a `config_failed` run, visible through the runs API.
 * - `vus` and `durationSeconds` default to {@link LOAD_DEFAULT_VUS} and
 *   {@link LOAD_DEFAULT_DURATION_SECONDS} and may not exceed the ceilings above.
 */
export const LoadRunInputSchema = z.strictObject({
  script: scriptPath,
  targetUrl: z.string().refine(isPlainHttpUrl, 'must be an http(s) URL without credentials'),
  vus: vus.optional(),
  durationSeconds: durationSeconds.optional(),
  projectId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  releaseId: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
});
export type LoadRunInput = z.infer<typeof LoadRunInputSchema>;

/**
 * What a load job carries in `configuration.k6`, and what the runner reads back: every value
 * explicit and inside the same ceilings, so the runner never has to guess a default.
 */
export const LoadJobConfigurationSchema = z.strictObject({
  script: scriptPath,
  vus,
  durationSeconds,
});
export type LoadJobConfiguration = z.infer<typeof LoadJobConfigurationSchema>;
