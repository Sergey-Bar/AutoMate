import { describe, expect, it } from 'vitest';
import { connectorConfigs } from './schema.js';

describe('schema connectorConfigs', () => {
  it('contains unique connector name field', () => {
    expect(connectorConfigs.connectorName).toBeDefined();
  });
});
