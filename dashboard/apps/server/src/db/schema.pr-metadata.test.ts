/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';

describe('PR Metadata Columns', () => {
  it('runs table has prNumber column', async () => {
    const { runs } = await import('./schema.js');
    expect(runs.prNumber).toBeDefined();
  });

  it('runs table has prBranch column', async () => {
    const { runs } = await import('./schema.js');
    expect(runs.prBranch).toBeDefined();
  });

  it('runs table has baseBranch column', async () => {
    const { runs } = await import('./schema.js');
    expect(runs.baseBranch).toBeDefined();
  });

  it('runs table has commitAuthor column', async () => {
    const { runs } = await import('./schema.js');
    expect(runs.commitAuthor).toBeDefined();
  });
});
