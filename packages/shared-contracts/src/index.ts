/**
 * @automate/shared-contracts
 *
 * Contract types and validation schemas shared across services.
 *
 * Exports:
 * - Zod v4 schemas (TriggerRunRequestSchema, RunResultCallbackSchema, …)
 * - TypeScript types inferred from schemas (TriggerRunRequest, RunResultCallback, …)
 * - JSON Schema objects for AJV consumers (triggerRunRequestSchema, …)
 *
 * See README.md for the JSON Schema / AJV compatibility strategy.
 */
export * from './schemas/index.js';
