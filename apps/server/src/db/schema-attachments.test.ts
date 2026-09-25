import { describe, expect, it } from 'vitest';
import { messageAttachments } from './schema.js';

describe('schema messageAttachments', () => {
  it('stores content type and path', () => {
    expect(messageAttachments.contentType).toBeDefined();
    expect(messageAttachments.path).toBeDefined();
  });
});
