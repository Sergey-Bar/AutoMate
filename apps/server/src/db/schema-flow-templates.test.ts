import { describe, expect, it } from 'vitest';
import { flowTemplates } from './schema.js';

describe('schema flowTemplates', () => {
  it('contains systemPrompt and steps columns', () => {
    expect(flowTemplates.systemPrompt).toBeDefined();
    expect(flowTemplates.steps).toBeDefined();
  });
});
