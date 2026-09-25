import {
  ConnectorNameSchema,
  ConnectorConfigSchema,
  ConnectorHealthSchema,
  ConnectorStatusSchema,
} from './connectors.js';

// ---------------------------------------------------------------------------
// ConnectorNameSchema
// ---------------------------------------------------------------------------

describe('ConnectorNameSchema', () => {
  it('accepts all defined connector names', () => {
    const names = ['github', 'jira', 'slack', 'sql-browser', 'teams', 'gitlab', 'linear'];
    for (const n of names) {
      expect(ConnectorNameSchema.safeParse(n).success).toBe(true);
    }
  });

  it('rejects an unknown connector name', () => {
    expect(ConnectorNameSchema.safeParse('pagerduty').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConnectorConfigSchema
// ---------------------------------------------------------------------------

describe('ConnectorConfigSchema', () => {
  it('accepts a valid full connector config', () => {
    const result = ConnectorConfigSchema.safeParse({
      id: 'cfg-001',
      connectorName: 'github',
      enabled: true,
      credentialRef: 'vault://github',
      settings: { owner: 'automate-hq', repo: 'platform' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a minimal connector config', () => {
    const result = ConnectorConfigSchema.safeParse({
      id: 'cfg-002',
      connectorName: 'slack',
      enabled: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when connectorName is missing', () => {
    const result = ConnectorConfigSchema.safeParse({
      id: 'cfg-003',
      enabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('connectorName');
    }
  });

  it('rejects an invalid connector name value', () => {
    const result = ConnectorConfigSchema.safeParse({
      id: 'cfg-004',
      connectorName: 'zapier',
      enabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConnectorHealthSchema
// ---------------------------------------------------------------------------

describe('ConnectorHealthSchema', () => {
  it('accepts a connected health status', () => {
    const result = ConnectorHealthSchema.safeParse({
      connectorName: 'github',
      status: 'connected',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an error health status with message', () => {
    const result = ConnectorHealthSchema.safeParse({
      connectorName: 'jira',
      status: 'error',
      message: 'Invalid credentials',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status value', () => {
    const result = ConnectorHealthSchema.safeParse({
      connectorName: 'slack',
      status: 'healthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('status');
    }
  });

  it('rejects when checkedAt is missing', () => {
    const result = ConnectorHealthSchema.safeParse({
      connectorName: 'github',
      status: 'connected',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('checkedAt');
    }
  });
});

// ---------------------------------------------------------------------------
// ConnectorStatusSchema
// ---------------------------------------------------------------------------

describe('ConnectorStatusSchema', () => {
  it('accepts a valid connector status with health', () => {
    const result = ConnectorStatusSchema.safeParse({
      connectorName: 'github',
      enabled: true,
      hasCredentials: true,
      health: {
        connectorName: 'github',
        status: 'connected',
        checkedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a status without health', () => {
    const result = ConnectorStatusSchema.safeParse({
      connectorName: 'slack',
      enabled: false,
      hasCredentials: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when hasCredentials is missing', () => {
    const result = ConnectorStatusSchema.safeParse({
      connectorName: 'slack',
      enabled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('hasCredentials');
    }
  });
});
