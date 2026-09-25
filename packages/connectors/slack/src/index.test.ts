import { describe, expect, it } from 'vitest';
import { slackAdapter } from './index.js';

describe('slack adapter', () => {
  it('declares bounded auth and message operations', () => {
    expect(slackAdapter.manifest.name).toBe('slack');
    expect(slackAdapter.manifest.operations.postMessage?.sideEffecting).toBe(true);
  });
});
