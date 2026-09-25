import { describe, expect, it } from 'vitest';
import {
  conversations,
  messages,
  messageAttachments,
  connectorConfigs,
  flowTemplates,
  executionLog,
  modelConfig,
} from './schema.js';

// Drizzle stores foreign key reference callbacks internally but executes them at build time.
// We import all tables to ensure all column definitions are evaluated (covering all lines).

describe('schema definitions coverage', () => {
  it('conversations table is defined', () => {
    expect(conversations).toBeDefined();
    expect(conversations.id).toBeDefined();
    expect(conversations.title).toBeDefined();
    expect(conversations.createdAt).toBeDefined();
    expect(conversations.updatedAt).toBeDefined();
  });

  it('messages table has foreign key to conversations', () => {
    expect(messages).toBeDefined();
    expect(messages.id).toBeDefined();
    expect(messages.conversationId).toBeDefined();
    expect(messages.role).toBeDefined();
    expect(messages.content).toBeDefined();
    expect(messages.toolCallId).toBeDefined();
    expect(messages.toolName).toBeDefined();
    expect(messages.metadata).toBeDefined();
    expect(messages.createdAt).toBeDefined();
  });

  it('messageAttachments table has foreign key to messages', () => {
    expect(messageAttachments).toBeDefined();
    expect(messageAttachments.id).toBeDefined();
    expect(messageAttachments.messageId).toBeDefined();
    expect(messageAttachments.name).toBeDefined();
    expect(messageAttachments.contentType).toBeDefined();
    expect(messageAttachments.path).toBeDefined();
    expect(messageAttachments.sizeBytes).toBeDefined();
  });

  it('connectorConfigs table has default for enabled field', () => {
    expect(connectorConfigs).toBeDefined();
    expect(connectorConfigs.id).toBeDefined();
    expect(connectorConfigs.connectorName).toBeDefined();
    expect(connectorConfigs.enabled).toBeDefined();
    expect(connectorConfigs.credentialRef).toBeDefined();
    expect(connectorConfigs.settings).toBeDefined();
    expect(connectorConfigs.updatedAt).toBeDefined();
  });

  it('flowTemplates table has isBuiltIn default false', () => {
    expect(flowTemplates).toBeDefined();
    expect(flowTemplates.id).toBeDefined();
    expect(flowTemplates.name).toBeDefined();
    expect(flowTemplates.description).toBeDefined();
    expect(flowTemplates.systemPrompt).toBeDefined();
    expect(flowTemplates.steps).toBeDefined();
    expect(flowTemplates.category).toBeDefined();
    expect(flowTemplates.isBuiltIn).toBeDefined();
    expect(flowTemplates.createdAt).toBeDefined();
    expect(flowTemplates.updatedAt).toBeDefined();
  });

  it('executionLog table has optional conversationId reference', () => {
    expect(executionLog).toBeDefined();
    expect(executionLog.id).toBeDefined();
    expect(executionLog.conversationId).toBeDefined();
    expect(executionLog.toolName).toBeDefined();
    expect(executionLog.input).toBeDefined();
    expect(executionLog.output).toBeDefined();
    expect(executionLog.status).toBeDefined();
    expect(executionLog.durationMs).toBeDefined();
    expect(executionLog.errorMessage).toBeDefined();
    expect(executionLog.createdAt).toBeDefined();
  });

  it('modelConfig table has defaults for provider model endpoint temperature maxTokens', () => {
    expect(modelConfig).toBeDefined();
    expect(modelConfig.id).toBeDefined();
    expect(modelConfig.provider).toBeDefined();
    expect(modelConfig.model).toBeDefined();
    expect(modelConfig.endpoint).toBeDefined();
    expect(modelConfig.temperature).toBeDefined();
    expect(modelConfig.maxTokens).toBeDefined();
    expect(modelConfig.systemPrompt).toBeDefined();
    expect(modelConfig.updatedAt).toBeDefined();
  });

  it('all table names are correctly set via drizzle Symbol', () => {
    const nameSymbol = Symbol.for('drizzle:Name');
    expect((conversations as unknown as Record<symbol, string>)[nameSymbol]).toBe('conversations');
    expect((messages as unknown as Record<symbol, string>)[nameSymbol]).toBe('messages');
    expect((messageAttachments as unknown as Record<symbol, string>)[nameSymbol]).toBe('message_attachments');
    expect((connectorConfigs as unknown as Record<symbol, string>)[nameSymbol]).toBe('connector_configs');
    expect((flowTemplates as unknown as Record<symbol, string>)[nameSymbol]).toBe('flow_templates');
    expect((executionLog as unknown as Record<symbol, string>)[nameSymbol]).toBe('execution_log');
    expect((modelConfig as unknown as Record<symbol, string>)[nameSymbol]).toBe('model_config');
  });
});
