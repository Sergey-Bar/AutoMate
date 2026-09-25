import { describe, expect, it } from 'vitest';
import { FlowTemplateSchema } from './index.js';

describe('FlowTemplateSchema', () => {
  it('parses a built-in flow template', () => {
    const flow = FlowTemplateSchema.parse({
      id: 'regression-gate',
      name: 'Regression Gate',
      description: 'Run tests then post summary',
      systemPrompt: 'You are QA orchestrator',
      steps: '[]',
      category: 'regression',
      isBuiltIn: true,
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(flow.isBuiltIn).toBe(true);
  });
});
