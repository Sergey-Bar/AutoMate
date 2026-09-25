import { describe, expect, it } from 'vitest';
import { integrationMaturity, listIntegrationMaturity } from './maturity.js';

describe('integration maturity registry', () => {
  it('lists capability levels without claiming unverified integrations', () => {
    const items = listIntegrationMaturity();
    expect(items.length).toBeGreaterThan(5);
    expect(items.find((item) => item.id === 'playwright-test')?.level).toBe('L4');
    expect(integrationMaturity('missing')).toBeNull();
    expect(integrationMaturity('junit')?.evidenceStatus).toBe('verified');
  });
});
