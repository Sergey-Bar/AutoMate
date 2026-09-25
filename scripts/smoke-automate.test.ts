import { describe, expect, it } from 'vitest';
import { smokeChecklist, runSmokeChecklist } from './smoke-automate.js';

describe('smokeChecklist', () => {
  it('is an array of checklist items', () => {
    expect(Array.isArray(smokeChecklist)).toBe(true);
    expect(smokeChecklist.length).toBeGreaterThan(0);
  });

  it('each item has name and check function', () => {
    for (const item of smokeChecklist) {
      expect(typeof item.name).toBe('string');
      expect(typeof item.check).toBe('function');
    }
  });

  it('includes health endpoint check', () => {
    const names = smokeChecklist.map((i) => i.name);
    expect(names.some((n) => n.toLowerCase().includes('health'))).toBe(true);
  });

  it('includes packages check', () => {
    const names = smokeChecklist.map((i) => i.name);
    expect(names.some((n) => n.toLowerCase().includes('package'))).toBe(true);
  });
});

describe('runSmokeChecklist', () => {
  it('returns results for all checklist items', async () => {
    const results = await runSmokeChecklist();
    expect(results.length).toBe(smokeChecklist.length);
  });

  it('each result has name, passed, and optional message', async () => {
    const results = await runSmokeChecklist();
    for (const result of results) {
      expect(typeof result.name).toBe('string');
      expect(typeof result.passed).toBe('boolean');
    }
  });
});
