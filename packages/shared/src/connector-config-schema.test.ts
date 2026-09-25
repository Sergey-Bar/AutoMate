import { describe, expect, it } from 'vitest';
import { ConnectorConfigSchema } from './index.js';

describe('ConnectorConfigSchema', () => {
  it('parses enabled connector config', () => {
    const cfg = ConnectorConfigSchema.parse({
      id: 'g1',
      connectorName: 'github',
      enabled: true,
      credentialRef: 'vault:github',
      settings: '{}',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(cfg.enabled).toBe(true);
  });
});
