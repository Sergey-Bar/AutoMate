import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  conversations,
  messages,
  messageAttachments,
  executionLog,
  connectorConfigs,
  flowTemplates,
  modelConfig,
} from './schema.js';

describe('schema foreign key references coverage', () => {
  it('messages.conversationId references conversations.id (line 16 callback)', () => {
    // getTableConfig calls the references() callbacks to build the table config
    const config = getTableConfig(messages);
    expect(config.foreignKeys.length).toBeGreaterThan(0);
    const fk = config.foreignKeys[0];
    // fk.reference is a function — calling it invokes the .references() arrow callback
    const ref = fk.reference();
    expect(ref.foreignColumns.length).toBeGreaterThan(0);
    // Should reference conversations.id
    expect(ref.foreignColumns[0].name).toBe('id');
  });

  it('messageAttachments.messageId references messages.id (line 29 callback)', () => {
    const config = getTableConfig(messageAttachments);
    expect(config.foreignKeys.length).toBeGreaterThan(0);
    const fk = config.foreignKeys[0];
    const ref = fk.reference();
    expect(ref.foreignColumns[0].name).toBe('id');
  });

  it('executionLog.conversationId references conversations.id (line 59 callback)', () => {
    const config = getTableConfig(executionLog);
    expect(config.foreignKeys.length).toBeGreaterThan(0);
    const fk = config.foreignKeys[0];
    const ref = fk.reference();
    expect(ref.foreignColumns[0].name).toBe('id');
  });

  it('connectorConfigs has no foreign keys', () => {
    const config = getTableConfig(connectorConfigs);
    expect(config.foreignKeys.length).toBe(0);
  });

  it('flowTemplates has no foreign keys', () => {
    const config = getTableConfig(flowTemplates);
    expect(config.foreignKeys.length).toBe(0);
  });

  it('conversations has no foreign keys', () => {
    const config = getTableConfig(conversations);
    expect(config.foreignKeys.length).toBe(0);
  });

  it('modelConfig has default value for id column', () => {
    const config = getTableConfig(modelConfig);
    const idCol = config.columns.find(c => c.name === 'id');
    expect(idCol?.default).toBe('default');
  });

  it('modelConfig has defaults for provider model endpoint', () => {
    const config = getTableConfig(modelConfig);
    const providerCol = config.columns.find(c => c.name === 'provider');
    const modelCol = config.columns.find(c => c.name === 'model');
    const endpointCol = config.columns.find(c => c.name === 'endpoint');
    const tempCol = config.columns.find(c => c.name === 'temperature');
    const maxTokensCol = config.columns.find(c => c.name === 'max_tokens');
    expect(providerCol?.default).toBe('ollama');
    expect(modelCol?.default).toBe('llama3.1');
    expect(endpointCol?.default).toBe('http://localhost:11434');
    expect(tempCol?.default).toBe(0.7);
    expect(maxTokensCol?.default).toBe(4096);
  });

  it('connectorConfigs has default false for enabled column', () => {
    const config = getTableConfig(connectorConfigs);
    const enabledCol = config.columns.find(c => c.name === 'enabled');
    expect(enabledCol?.default).toBe(false);
  });

  it('flowTemplates has default false for is_built_in column', () => {
    const config = getTableConfig(flowTemplates);
    const builtInCol = config.columns.find(c => c.name === 'is_built_in');
    expect(builtInCol?.default).toBe(false);
  });
});
