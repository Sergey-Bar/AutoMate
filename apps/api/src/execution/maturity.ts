import {
  IntegrationMaturitySchema,
  type IntegrationMaturity,
  type IntegrationMaturityLevel,
  type IntegrationEvidenceStatus,
} from '@automate/shared-contracts';

export type { IntegrationMaturity, IntegrationMaturityLevel, IntegrationEvidenceStatus };

const INTEGRATION_MATURITY_SOURCE = [
  {
    id: 'playwright-test',
    name: 'Playwright Test',
    domain: 'browser',
    level: 'L4',
    capabilities: ['browser', 'test-execution', 'evidence-upload'],
    adapterVersion: 'execution-1',
    evidenceStatus: 'verified',
    evidence: ['runner-protocol', 'playwright-execution', 'smoke-fixtures'],
  },
  {
    id: 'playwright.execution',
    name: 'Playwright execution adapter',
    domain: 'browser',
    level: 'L4',
    capabilities: ['browser', 'test-execution', 'evidence-upload'],
    adapterVersion: 'execution-1',
    evidenceStatus: 'verified',
    evidence: ['runner-protocol', 'playwright-execution', 'smoke-fixtures'],
  },
  {
    id: 'junit',
    name: 'JUnit',
    domain: 'import',
    level: 'L2',
    capabilities: ['import', 'normalized-results'],
    adapterVersion: 'legacy-1',
    evidenceStatus: 'verified',
    evidence: ['legacy-reporter-upload'],
  },
  {
    id: 'playwright-json',
    name: 'Playwright JSON',
    domain: 'import',
    level: 'L2',
    capabilities: ['import', 'normalized-results'],
    adapterVersion: 'legacy-1',
    evidenceStatus: 'verified',
    evidence: ['legacy-reporter-upload'],
  },
  {
    id: 'cypress',
    name: 'Cypress',
    domain: 'browser',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
  {
    id: 'selenium',
    name: 'Selenium',
    domain: 'browser',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'webdriverio',
    name: 'WebdriverIO',
    domain: 'browser',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'vitest',
    name: 'Vitest',
    domain: 'unit',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'jest',
    name: 'Jest',
    domain: 'unit',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'pytest',
    name: 'pytest',
    domain: 'unit',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'bruno',
    name: 'Bruno',
    domain: 'api',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
  {
    id: 'newman',
    name: 'Newman',
    domain: 'api',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'k6',
    name: 'k6',
    domain: 'performance',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
  {
    id: 'zap',
    name: 'OWASP ZAP',
    domain: 'security',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
  {
    id: 'appium',
    name: 'Appium',
    domain: 'mobile',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'maestro',
    name: 'Maestro',
    domain: 'mobile',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
];

export const INTEGRATION_MATURITY_REGISTRY: readonly IntegrationMaturity[] =
  IntegrationMaturitySchema.array().parse(INTEGRATION_MATURITY_SOURCE);

export function listIntegrationMaturity(): IntegrationMaturity[] {
  return INTEGRATION_MATURITY_REGISTRY.map((entry) => ({
    ...entry,
    capabilities: [...entry.capabilities],
    evidence: [...entry.evidence],
  }));
}

export function integrationMaturity(id: string): IntegrationMaturity | null {
  const entry = INTEGRATION_MATURITY_REGISTRY.find((item) => item.id === id);
  return entry
    ? { ...entry, capabilities: [...entry.capabilities], evidence: [...entry.evidence] }
    : null;
}
