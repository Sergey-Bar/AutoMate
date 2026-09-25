import { describe, expect, it } from 'vitest';
import { parseJsonSafe } from './index.js';

describe('parseJsonSafe', () => {
  it('returns fallback when value is null', () => {
    expect(parseJsonSafe(null, { ok: false })).toEqual({ ok: false });
  });

  it('returns fallback on invalid json', () => {
    expect(parseJsonSafe('{oops', { ok: false })).toEqual({ ok: false });
  });
});
