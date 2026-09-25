import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => {
  const mockDb = {
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { builtInFlowTemplates, seedDb } from './seed.js';

describe('builtInFlowTemplates', () => {
  it('contains Regression Gate template', () => {
    expect(builtInFlowTemplates.some((f) => f.id === 'regression-gate')).toBe(true);
  });
});

describe('seedDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts default model config and regression-gate template', async () => {
    const { db } = await import('./client.js');
    await seedDb();
    // Called once for model_config + once per template
    expect(db.execute).toHaveBeenCalledTimes(1 + builtInFlowTemplates.length);
  });

  it('is idempotent when run multiple times', async () => {
    const { db } = await import('./client.js');
    await seedDb();
    await seedDb();
    // Each call: 1 model_config + N templates
    const expectedPerCall = 1 + builtInFlowTemplates.length;
    expect(db.execute).toHaveBeenCalledTimes(expectedPerCall * 2);
  });
});
