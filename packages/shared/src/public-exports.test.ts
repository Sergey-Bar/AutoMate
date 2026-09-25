import { describe, expect, it } from 'vitest';
import * as shared from './index.js';

describe('shared exports', () => {
  it('exports all q-ace schemas', () => {
    expect(shared.ConversationSchema).toBeDefined();
    expect(shared.MessageSchema).toBeDefined();
    expect(shared.ConnectorConfigSchema).toBeDefined();
    expect(shared.FlowTemplateSchema).toBeDefined();
  });

  it('exports ProviderSchema and ModelConfigSchema', () => {
    expect(shared.ProviderSchema).toBeDefined();
    expect(shared.ModelConfigSchema).toBeDefined();
  });
});
