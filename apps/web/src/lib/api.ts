import { z } from 'zod/v4';
import { RunUpdatedEventSchema } from '@automate/realtime';

export const RunSchema = z.object({
  id: z.string(),
  projectName: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nullable().optional(),
  total: z.number().optional(),
  passed: z.number().optional(),
  failed: z.number().optional(),
});

export type Run = z.infer<typeof RunSchema>;
export type RunUpdatedEvent = z.infer<typeof RunUpdatedEventSchema>;

export const AnalyticsSummarySchema = z.object({
  totalRuns: z.number(),
  passRate: z.number(),
  avgDurationMs: z.number().nullable(),
});

export const QuarantineEntrySchema = z.object({
  id: z.string(),
  testTitle: z.string(),
  testFile: z.string(),
  reason: z.string().nullable(),
  quarantinedAt: z.string(),
});

export const SuiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectName: z.string().optional(),
  totalRuns: z.number().optional(),
  lastRunAt: z.string().nullable().optional(),
  passRate: z.number().nullable().optional(),
});

export const TestSchema = z.object({
  id: z.string(),
  title: z.string(),
  file: z.string().optional(),
  status: z.string(),
  durationMs: z.number().nullable().optional(),
  runId: z.string().optional(),
  suiteName: z.string().optional(),
});

export type Suite = z.infer<typeof SuiteSchema>;
export type Test = z.infer<typeof TestSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
});

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'data']),
  content: z.string(),
  createdAt: z.string(),
});

export const ModelConfigSchema = z.object({
  model: z.string(),
  temperature: z.number(),
});

export const ConnectorSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  type: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
  lastSynced: z.string().nullable().optional(),
  description: z.string().optional(),
});

export const VaultSecretSchema = z.object({
  id: z.string(),
  name: z.string(),
  connector: z.string().optional(),
  updatedAt: z.string(),
});

const CanonicalConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.enum(['configured', 'not_configured', 'error']),
  createdAt: z.string(),
  description: z.string().nullable().optional(),
});

const CanonicalVaultCredentialSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  key: z.string(),
  createdAt: z.string(),
});

export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type VaultSecret = z.infer<typeof VaultSecretSchema>;

export const A11ySeveritySchema = z.enum(['critical', 'serious', 'moderate', 'minor']);

export const A11yViolationSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  description: z.string(),
  severity: A11ySeveritySchema,
  element: z.string(),
  fix: z.string(),
  page: z.string(),
});

export const A11yAuditResultSchema = z.object({
  violations: z.array(A11yViolationSchema),
  pagesScanned: z.number(),
  scannedAt: z.string(),
});

export type A11ySeverity = z.infer<typeof A11ySeveritySchema>;
export type A11yViolation = z.infer<typeof A11yViolationSchema>;
export type A11yAuditResult = z.infer<typeof A11yAuditResultSchema>;

export interface ApiClient {
  getRuns(): Promise<Run[]>;
  getRun(id: string): Promise<Run>;
  getSuites(): Promise<Suite[]>;
  getTests(): Promise<Test[]>;
  getAnalyticsSummary(): Promise<AnalyticsSummary>;
  getQuarantine(): Promise<QuarantineEntry[]>;
  addQuarantine(entry: { testTitle: string; testFile: string; reason?: string }): Promise<QuarantineEntry>;
  onRunUpdated(callback: (event: RunUpdatedEvent) => void): () => void;
  getConversations(): Promise<Conversation[]>;
  createConversation(title: string): Promise<Conversation>;
  sendMessage(conversationId: string, message: string): Promise<Message>;
  getMessages(conversationId: string): Promise<Message[]>;
  getModelConfig(): Promise<ModelConfig>;
  updateModelConfig(config: ModelConfig): Promise<ModelConfig>;
  getConnectors(): Promise<Connector[]>;
  getVaultSecrets(): Promise<VaultSecret[]>;
  deleteVaultSecret(id: string): Promise<void>;
  getA11yAudit(): Promise<A11yAuditResult>;
}

export const defaultApiClient: ApiClient = {
  getRuns: async () => {
    const res = await fetch('/api/v1/runs');
    if (!res.ok) throw new Error('Failed to fetch runs');
    const data = await res.json();
    return z.array(RunSchema).parse(data);
  },
  getRun: async (id) => {
    const res = await fetch(`/api/v1/dashboard/runs/${id}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Run not found');
      throw new Error('Failed to fetch run');
    }
    const data = await res.json();
    return RunSchema.parse(data);
  },
  getAnalyticsSummary: async () => {
    const res = await fetch('/api/v1/dashboard/analytics/summary');
    if (!res.ok) throw new Error('Failed to fetch analytics');
    const data = await res.json();
    return AnalyticsSummarySchema.parse(data);
  },
  getQuarantine: async () => {
    const res = await fetch('/api/v1/dashboard/quarantine');
    if (!res.ok) throw new Error('Failed to fetch quarantine list');
    const data = await res.json();
    return z.array(QuarantineEntrySchema).parse(data);
  },
  getSuites: async () => {
    const res = await fetch('/api/v1/dashboard/suites');
    if (!res.ok) throw new Error('Failed to fetch suites');
    const data = await res.json();
    return z.array(SuiteSchema).parse(data);
  },
  getTests: async () => {
    const res = await fetch('/api/v1/dashboard/tests');
    if (!res.ok) throw new Error('Failed to fetch tests');
    const data = await res.json();
    return z.array(TestSchema).parse(data);
  },
  addQuarantine: async (entry) => {
    const res = await fetch('/api/v1/dashboard/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error('Failed to add to quarantine');
    const data = await res.json();
    return QuarantineEntrySchema.parse(data);
  },
  onRunUpdated: (callback) => {
    if (typeof EventSource === 'undefined') {
      return () => {};
    }
    const sse = new EventSource('/api/v1/events');
    
    // Some implementations send the whole payload as data, some use explicit event types.
    // We'll listen for messages and parse them.
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const parsed = RunUpdatedEventSchema.safeParse(data);
        if (parsed.success) {
          callback(parsed.data);
        }
      } catch (_err) {
        // Ignore parsing errors
      }
    };
    
    sse.addEventListener('run:updated', handler);
    sse.addEventListener('message', handler);
    
    return () => {
      sse.removeEventListener('run:updated', handler);
      sse.removeEventListener('message', handler);
      sse.close();
    };
  },
  getConversations: async () => {
    const res = await fetch('/api/v1/orchestrator/conversations');
    if (!res.ok) throw new Error('Failed to fetch conversations');
    const data = await res.json();
    return z.array(ConversationSchema).parse(data);
  },
  createConversation: async (title) => {
    const res = await fetch('/api/v1/orchestrator/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    const data = await res.json();
    return ConversationSchema.parse(data);
  },
  sendMessage: async (conversationId, message) => {
    const res = await fetch('/api/v1/orchestrator/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message }),
    });
    if (!res.ok) throw new Error('Failed to send message');
    const data = await res.json();
    return MessageSchema.parse(data);
  },
  getMessages: async (conversationId) => {
    const res = await fetch(`/api/v1/orchestrator/conversations/${conversationId}/messages`);
    if (!res.ok) throw new Error('Failed to fetch messages');
    const data = await res.json();
    return z.array(MessageSchema).parse(data);
  },
  getModelConfig: async () => {
    const res = await fetch('/api/v1/orchestrator/model-config');
    if (!res.ok) throw new Error('Failed to fetch model config');
    const data = await res.json();
    return ModelConfigSchema.parse(data);
  },
  updateModelConfig: async (config) => {
    const res = await fetch('/api/v1/orchestrator/model-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to update model config');
    const data = await res.json();
    return ModelConfigSchema.parse(data);
  },
  getConnectors: async () => {
    const res = await fetch('/api/v1/connectors');
    if (!res.ok) throw new Error('Failed to fetch connectors');
    const data = await res.json();
    const canonical = z.array(CanonicalConnectorSchema).parse(data);
    return canonical.map((item) => ({
      name: item.name,
      displayName: item.name,
      type: item.type,
      status:
        item.status === 'configured'
          ? 'active'
          : item.status === 'error'
            ? 'error'
            : 'inactive',
      lastSynced: null,
      ...(item.description ? { description: item.description } : {}),
    }));
  },
  getVaultSecrets: async () => {
    const res = await fetch('/api/v1/vault/credentials');
    if (!res.ok) throw new Error('Failed to fetch vault secrets');
    const data = await res.json();
    const credentials = z.array(CanonicalVaultCredentialSchema).parse(data);
    return credentials.map((item) => ({
      id: item.id,
      name: item.key,
      connector: item.connectorId,
      updatedAt: item.createdAt,
    }));
  },
  deleteVaultSecret: async (id) => {
    const res = await fetch(`/api/v1/vault/credentials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete vault secret');
  },
  getA11yAudit: async () => {
    const res = await fetch('/api/v1/a11y/audit');
    if (!res.ok) throw new Error('Failed to fetch a11y audit');
    const data = await res.json();
    return A11yAuditResultSchema.parse(data);
  },
};
