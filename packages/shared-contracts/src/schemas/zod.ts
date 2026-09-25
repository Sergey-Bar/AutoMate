/**
 * Zod v4 schemas for shared contract types.
 *
 * These are the canonical validation source for TypeScript consumers.
 * JSON Schema files (*.schema.json) in this directory are preserved for
 * AJV-based consumers — see README.md for the compatibility strategy.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// TriggerRunRequest
// ---------------------------------------------------------------------------

export const TriggerRunRequestSchema = z.object({
  specCode: z.string(),
  specFileName: z.string(),
  baseUrl: z.string().optional(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type TriggerRunRequest = z.infer<typeof TriggerRunRequestSchema>;

// ---------------------------------------------------------------------------
// TriggerRunResponse
// ---------------------------------------------------------------------------

export const TriggerRunResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
});

export type TriggerRunResponse = z.infer<typeof TriggerRunResponseSchema>;

// ---------------------------------------------------------------------------
// RunResultCallback
// ---------------------------------------------------------------------------

export const RunResultCallbackSchema = z.object({
  runId: z.string(),
  status: z.enum(['completed', 'failed', 'timeout']),
  duration: z.number(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  errors: z
    .array(
      z.object({
        testName: z.string(),
        message: z.string(),
        stack: z.string().optional(),
      }),
    )
    .optional(),
  triggeredBy: z.string(),
  triggeredAt: z.string(),
  completedAt: z.string(),
});

export type RunResultCallback = z.infer<typeof RunResultCallbackSchema>;

// ---------------------------------------------------------------------------
// ServiceHealthStatus
// ---------------------------------------------------------------------------

export const ServiceHealthStatusSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string().optional(),
  uptime: z.number().optional(),
  checks: z
    .record(
      z.string(),
      z.object({
        status: z.enum(['ok', 'error']),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

export type ServiceHealthStatus = z.infer<typeof ServiceHealthStatusSchema>;

// ---------------------------------------------------------------------------
// UnifiedAuthToken
// ---------------------------------------------------------------------------

export const UnifiedAuthTokenSchema = z.object({
  valid: z.boolean(),
  userId: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type UnifiedAuthToken = z.infer<typeof UnifiedAuthTokenSchema>;
