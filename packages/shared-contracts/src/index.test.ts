import { describe, expect, it } from 'vitest';
import { CanonicalRunResultSchema, CanonicalReporterEventSchema } from './schemas/index.js';

describe('shared contract exports', () => {
  it('exports Zod authorities without JSON import assertions', () => {
    expect(CanonicalRunResultSchema).toBeDefined();
    expect(CanonicalReporterEventSchema).toBeDefined();
  });
});
