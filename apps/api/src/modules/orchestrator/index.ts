/**
 * index.ts — Orchestrator Hono sub-app
 *
 * Combines all orchestrator route modules under a single Hono instance.
 * Mount in apps/api/src/index.ts via: app.route('/', createOrchestratorModule())
 */
import { Hono } from 'hono';
import {
  createOrchestratorConversationRoutes,
  InMemoryConversationStore,
} from './conversations.js';
import {
  createOrchestratorModelConfigRoutes,
  InMemoryModelConfigStore,
} from './model-config.js';
import { createOrchestratorChatRoutes } from './chat.js';
import { createOrchestratorTestGenRoutes } from './test-gen.js';
import {
  createOrchestratorMessageRoutes,
  InMemoryMessageStore,
} from './messages.js';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface OrchestratorModuleOptions {
  /** Optional pre-constructed conversation store (for testing) */
  conversationStore?: InstanceType<typeof InMemoryConversationStore>;
  /** Optional pre-constructed model config store (for testing) */
  modelConfigStore?: InstanceType<typeof InMemoryModelConfigStore>;
  /** Optional pre-constructed message store (for testing) */
  messageStore?: InstanceType<typeof InMemoryMessageStore>;
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createOrchestratorModule(options: OrchestratorModuleOptions = {}): Hono {
  const app = new Hono();

  // Shared in-memory stores (per-process lifetime, temporary until Postgres layer)
  const conversationStore = options.conversationStore ?? new InMemoryConversationStore();
  const modelConfigStore = options.modelConfigStore ?? new InMemoryModelConfigStore();
  const messageStore = options.messageStore ?? new InMemoryMessageStore();

  app.route('/', createOrchestratorConversationRoutes({ store: conversationStore }));
  app.route('/', createOrchestratorModelConfigRoutes({ store: modelConfigStore }));
  app.route('/', createOrchestratorChatRoutes({ conversationStore, messageStore }));
  app.route('/', createOrchestratorTestGenRoutes());
  app.route('/', createOrchestratorMessageRoutes({ conversationStore, messageStore }));

  return app;
}

// Re-export store types and implementations so callers can inject custom stores for testing
export type { ConversationStore } from './conversations.js';
export type { ModelConfigStore, ModelConfig } from './model-config.js';
export type { TestGenMode, TestGenResult } from './test-gen.js';
export type { MessageStore, Message } from './messages.js';
export { InMemoryConversationStore } from './conversations.js';
export { InMemoryModelConfigStore } from './model-config.js';
export { InMemoryMessageStore } from './messages.js';
