import { z } from 'zod';

export {
  AiProviderSchema,
  AiProviderConfigSchema,
} from './ai-provider-schema.js';
export type { AiProvider, AiProviderConfig } from './ai-provider-schema.js';

// ─── Shared enums ──────────────────────────────────────────────────────────
export const TestStatus = z.enum(['passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued']);
export type TestStatus = z.infer<typeof TestStatus>;

export const RunStatus = z.enum(['running', 'passed', 'failed', 'interrupted']);
export type RunStatus = z.infer<typeof RunStatus>;

// ─── DB row shapes (mirrors Drizzle schema) ────────────────────────────────
export const RunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: RunStatus,
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  flaky: z.number(),
  skipped: z.number(),
  durationMs: z.number().nullable(),
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  commitMessage: z.string().nullable(),
  triggeredBy: z.string().nullable(),
  config: z.string().nullable(),
  rawArgs: z.string().nullable(),
  gateStatus: z.enum(['passed', 'failed', 'skipped']).nullable().optional(),
  source: z.enum(['live', 'blob']).nullable().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const TestSchema = z.object({
  id: z.string(),
  runId: z.string(),
  suiteId: z.string().nullable(),
  title: z.string(),
  file: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  status: TestStatus,
  durationMs: z.number().nullable(),
  tags: z.string().nullable(), // JSON
  annotations: z.string().nullable(), // JSON
  retryCount: z.number().nullable(),
  expectedStatus: z.string().nullable(),
  workerIndex: z.number().nullable(),
  stableId: z.string().nullable(),
});
export type Test = z.infer<typeof TestSchema>;

// ─── Extended test with parsed tags and hydrated results ──────────────────
export interface TestWithResults extends Omit<Test, 'tags' | 'annotations'> {
  /** Parsed tag array (DB stores JSON string) */
  tags: string[];
  annotations: Array<{ type: string; description?: string }>;
  suite?: string;
  retries: number;
  startTime?: number; // ms offset from run start (for Gantt)
  results?: ResultParsed[];
}

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.object({
    title: z.string(),
    category: z.string(),
    durationMs: z.number().optional(),
    error: z.object({ message: z.string(), stack: z.string().optional() }).optional(),
    location: z.object({ file: z.string(), line: z.number(), column: z.number() }).optional(),
    steps: z.array(StepSchema),
  }),
);
export interface Step {
  title: string;
  category: string;
  durationMs?: number;
  startTime?: number; // ms offset from test start
  endTime?: number; // ms offset from test start
  error?: { message: string; stack?: string };
  location?: { file: string; line: number; column: number };
  steps: Step[];
}

export const ResultSchema = z.object({
  id: z.string(),
  testId: z.string(),
  runId: z.string(),
  retry: z.number(),
  status: TestStatus,
  durationMs: z.number().nullable(),
  startedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  errorStack: z.string().nullable(),
  workerIndex: z.number().nullable(),
  parallelIndex: z.number().nullable(),
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  steps: z.string().nullable(),
  attachments: z.string().nullable(),
});
export type Result = z.infer<typeof ResultSchema>;

// ─── Attachment (parsed from Result.attachments JSON) ─────────────────────
export interface Attachment {
  name: string;
  contentType: string;
  path?: string;
  body?: string;
  autoCapture?: boolean;
}

// ─── Parsed result (steps/attachments hydrated from JSON) ─────────────────
export interface ResultParsed extends Omit<Result, 'steps' | 'attachments' | 'errorMessage' | 'errorStack'> {
  steps: Step[];
  attachments: Attachment[];
  error?: { message: string; stack?: string };
}

export function parseResult(r: Result): ResultParsed {
  return {
    ...r,
    steps: r.steps ? (JSON.parse(r.steps) as Step[]) : [],
    attachments: r.attachments ? (JSON.parse(r.attachments) as Attachment[]) : [],
    error: r.errorMessage ? { message: r.errorMessage, stack: r.errorStack ?? undefined } : undefined,
  };
}

// ─── WebSocket event types ─────────────────────────────────────────────────
export type WsEventType =
  | 'connected'
  | 'run:start'
  | 'test:begin'
  | 'test:end'
  | 'step:begin'
  | 'step:end'
  | 'stdout'
  | 'stderr'
  | 'run:end'
  | 'artifact:new';

export interface WsEvent<T = unknown> {
  type: WsEventType;
  runId: string;
  payload: T;
}

// ─── Test tree node (for react-arborist) ──────────────────────────────────
export interface TestTreeNode {
  id: string;
  name: string;
  type: 'file' | 'suite' | 'test';
  status?: TestStatus;
  durationMs?: number;
  workerIndex?: number;
  children?: TestTreeNode[];
  tags?: string[];
}

// ─── Run options (mirrors server RunOptions) ───────────────────────────────
export interface RunOptions {
  projects?: string[];
  grep?: string;
  workers?: number;
  retries?: number;
  trace?: 'off' | 'on' | 'on-first-retry' | 'retain-on-failure';
  headed?: boolean;
  shard?: { current: number; total: number };
  timeout?: number;
  maxFailures?: number;
  lastFailed?: boolean;
  updateSnapshots?: boolean;
  tags?: string[];
  configPath?: string;
  dryRun?: boolean;
}

// ─── Compare run types ───────────────────────────────────────────────────
export const CompareChangeType = z.enum(['new_failure', 'fixed', 'regression', 'unchanged', 'added', 'removed']);
export type CompareChangeType = z.infer<typeof CompareChangeType>;

export const CompareRowSchema = z.object({
  title: z.string(),
  file: z.string(),
  statusA: z.string().nullable(),
  statusB: z.string().nullable(),
  durationA: z.number().nullable(),
  durationB: z.number().nullable(),
  changeType: CompareChangeType,
});
export type CompareRow = z.infer<typeof CompareRowSchema>;

// ─── Post-MVP agent session schemas ───────────────────────────────────────
export const AgentSessionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  repository: z.string(),
  prNumber: z.number(),
  prBranch: z.string(),
  baseBranch: z.string().nullable(),
  prTitle: z.string().nullable(),
  prAuthor: z.string().nullable(),
  agentName: z.string(),
  matchedRule: z.string().nullable(),
  status: z.enum(['active', 'closed', 'error']),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  filesLastSyncedAt: z.string().nullable(),
  fileSyncStatus: z.enum(['pending', 'synced', 'failed']).nullable(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const CreateAgentSessionBodySchema = z.object({
  provider: z.string().min(1),
  repository: z.string().min(1),
  prNumber: z.number().int().positive(),
  prBranch: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
  prTitle: z.string().optional(),
  prAuthor: z.string().optional(),
  agentName: z.string().min(1),
});
export type CreateAgentSessionBody = z.infer<typeof CreateAgentSessionBodySchema>;

export const RepairPayloadSchema = z.object({
  protocolVersion: z.string(),
  failureId: z.string(),
  originatingAgent: z.string(),
  failedTests: z.array(z.object({
    testId: z.string(),
    title: z.string(),
    errorMessage: z.string(),
  })).min(1),
  repairAttemptNumber: z.number().int().min(1).max(3),
  maxRepairAttempts: z.number().int().min(1).max(3),
});
export type RepairPayload = z.infer<typeof RepairPayloadSchema>;

// ─── RBAC schemas ─────────────────────────────────────────────────────────────
export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  role: UserRoleSchema,
  tenantId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  name: UserRoleSchema,
  description: z.string(),
  permissions: z.string(), // JSON array of allowed actions
  tenantId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  keyHash: z.string(),
  userId: z.string().nullable(),
  role: UserRoleSchema,
  scopes: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  tenantId: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;
