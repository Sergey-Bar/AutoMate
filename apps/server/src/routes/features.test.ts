import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { featureRoutes } from './features.js';
import type { FeatureFlagName } from '../services/feature-flags.js';

vi.mock('../services/feature-flags.js', () => ({
  getFeatureFlags: vi.fn(),
}));

import { getFeatureFlags } from '../services/feature-flags.js';

const allFlagsOff: Record<FeatureFlagName, boolean> = {
  'mcp-client': false,
  'dashboard-connector': false,
  'unified-health': false,
  'openapi-parsing': false,
  'contract-test-gen': false,
  'ai-test-gen': false,
  'ai-test-gen-v2': false,
  'postman-import': false,
  'multi-provider': false,
  'quality-gate-orchestration': false,
  'ai-triage': false,
  'unified-auth': false,
};

describe('feature routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(featureRoutes);
    await app.ready();
  });

  it('GET /api/features returns the feature flags object', async () => {
    vi.mocked(getFeatureFlags).mockReturnValue({ ...allFlagsOff, 'mcp-client': false });

    const response = await app.inject({ method: 'GET', url: '/api/features' });

    expect(response.statusCode).toBe(200);
    expect(response.json()['mcp-client']).toBe(false);
    expect(getFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('GET /api/features returns enabled flags when feature is on', async () => {
    vi.mocked(getFeatureFlags).mockReturnValue({ ...allFlagsOff, 'mcp-client': true });

    const response = await app.inject({ method: 'GET', url: '/api/features' });

    expect(response.statusCode).toBe(200);
    expect(response.json()['mcp-client']).toBe(true);
  });

  it('GET /api/features returns empty object when no flags defined', async () => {
    vi.mocked(getFeatureFlags).mockReturnValue({} as Record<FeatureFlagName, boolean>);

    const response = await app.inject({ method: 'GET', url: '/api/features' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({});
  });
});
