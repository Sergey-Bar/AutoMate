import { describe, expectTypeOf, it } from 'vitest';
import type {
  ConnectorConfig,
  Conversation,
  ExecutionLogRow,
  FlowTemplate,
  Message,
  MessageAttachment,
  ModelConfigRow,
  NewConnectorConfig,
  NewConversation,
  NewMessage,
  NewModelConfig,
} from './schema.js';

describe('schema type exports', () => {
  it('exports inferred select/insert model helper types', () => {
    expectTypeOf<Conversation['id']>().toEqualTypeOf<string>();
    expectTypeOf<Conversation['title']>().toEqualTypeOf<string | null>();
    expectTypeOf<NewConversation['createdAt']>().toEqualTypeOf<string>();

    expectTypeOf<Message['conversationId']>().toEqualTypeOf<string>();
    expectTypeOf<NewMessage['role']>().toEqualTypeOf<'user' | 'assistant' | 'system' | 'tool'>();

    expectTypeOf<MessageAttachment['name']>().toEqualTypeOf<string>();

    expectTypeOf<ConnectorConfig['connectorName']>().toEqualTypeOf<string>();
    expectTypeOf<NewConnectorConfig['updatedAt']>().toEqualTypeOf<string>();

    expectTypeOf<FlowTemplate['systemPrompt']>().toEqualTypeOf<string>();

    expectTypeOf<ExecutionLogRow['status']>().toEqualTypeOf<'running' | 'success' | 'error' | 'timeout'>();

    expectTypeOf<ModelConfigRow['provider']>().toEqualTypeOf<string>();
    expectTypeOf<NewModelConfig['updatedAt']>().toEqualTypeOf<string>();
  });
});
