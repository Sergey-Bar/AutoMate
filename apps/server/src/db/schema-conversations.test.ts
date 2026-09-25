import { describe, expect, it } from 'vitest';
import { conversations } from './schema.js';

describe('schema conversations', () => {
  it('defines table name conversations', () => {
    const drizzleName = (conversations as unknown as Record<symbol, unknown>)[
      Symbol.for('drizzle:Name')
    ];
    expect(drizzleName).toBe('conversations');
  });
});
