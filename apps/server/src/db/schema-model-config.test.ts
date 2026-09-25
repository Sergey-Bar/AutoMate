import { describe, expect, it } from 'vitest';
import { modelConfig } from './schema.js';

describe('schema modelConfig', () => {
  it('contains endpoint and model fields', () => {
    expect(modelConfig.endpoint).toBeDefined();
    expect(modelConfig.model).toBeDefined();
  });
});
