/**
 * Connectors domain schemas — Zod v4
 *
 * Covers connector name enum, configuration, health checks, and status
 * for the Automate connector subsystem.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// ConnectorName
// ---------------------------------------------------------------------------

export const ConnectorNameSchema = z.enum([
  'github',
  'jira',
  'slack',
  'sql-browser',
  'teams',
  'gitlab',
  'linear',
]);
export type ConnectorName = z.infer<typeof ConnectorNameSchema>;

// ---------------------------------------------------------------------------
// ConnectorConfig
// ---------------------------------------------------------------------------

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  connectorName: ConnectorNameSchema,
  enabled: z.boolean(),
  credentialRef: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string(),
});
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

// ---------------------------------------------------------------------------
// ConnectorHealth
// ---------------------------------------------------------------------------

export const ConnectorHealthSchema = z.object({
  connectorName: ConnectorNameSchema,
  status: z.enum(['connected', 'disconnected', 'error', 'unknown']),
  message: z.string().optional(),
  checkedAt: z.string(),
});
export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;

// ---------------------------------------------------------------------------
// ConnectorStatus
// ---------------------------------------------------------------------------

export const ConnectorStatusSchema = z.object({
  connectorName: ConnectorNameSchema,
  enabled: z.boolean(),
  hasCredentials: z.boolean(),
  health: ConnectorHealthSchema.optional(),
});
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;
