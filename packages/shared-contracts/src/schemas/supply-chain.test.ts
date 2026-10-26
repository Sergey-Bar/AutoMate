import { describe, expect, it } from 'vitest';
import {
  DiffCoverageStatusSchema,
  PortfolioComponentsPageSchema,
  SbomComponentsPageSchema,
  SupplyChainPolicyRecordSchema,
  SupplyChainPolicySchema,
} from './supply-chain.js';

describe('SupplyChainPolicySchema', () => {
  it('defaults to failing on an unknown licence and an empty trust set', () => {
    expect(SupplyChainPolicySchema.parse({})).toEqual({
      licences: { failOnUnknown: true },
      provenance: { trustedKeysPem: [], trustedRootsPem: [] },
    });
  });

  it('keeps an allow list that is present but empty, because that allows nothing', () => {
    const parsed = SupplyChainPolicySchema.parse({ licences: { allow: [], deny: ['GPL-3.0'] } });
    expect(parsed.licences.allow).toEqual([]);
    expect(parsed.licences.deny).toEqual(['GPL-3.0']);
  });

  it('refuses an unknown digest source, a blank licence id and an oversized key list', () => {
    expect(
      SupplyChainPolicySchema.safeParse({ provenance: { expectedDigestSource: 'sbom' } }).success,
    ).toBe(false);
    expect(SupplyChainPolicySchema.safeParse({ licences: { deny: ['  '] } }).success).toBe(false);
    expect(
      SupplyChainPolicySchema.safeParse({
        provenance: { trustedKeysPem: Array.from({ length: 21 }, () => 'k') },
      }).success,
    ).toBe(false);
  });

  it('reads a record with no saved policy as null rather than a default', () => {
    expect(
      SupplyChainPolicyRecordSchema.parse({
        projectId: 'p',
        policy: null,
        updatedAt: null,
        updatedBy: null,
      }).policy,
    ).toBeNull();
  });
});

describe('the inventory and diff-coverage reads', () => {
  it('parse a page of components, a portfolio match and a waiting diff coverage', () => {
    expect(
      SbomComponentsPageSchema.safeParse({
        branch: 'main',
        components: [
          {
            purl: 'pkg:npm/left-pad@1.3.0',
            name: 'left-pad',
            version: '1.3.0',
            type: 'library',
            licences: ['MIT'],
            licenceExpression: 'MIT',
            supplier: null,
            branch: 'main',
            reportId: null,
          },
        ],
        total: 1,
        offset: 0,
        limit: 50,
      }).success,
    ).toBe(true);
    expect(
      PortfolioComponentsPageSchema.safeParse({
        matches: [
          {
            projectId: 'p',
            project: 'Service',
            slug: 'service',
            branch: 'main',
            purl: 'pkg:npm/left-pad@1.3.0',
            name: 'left-pad',
            version: '1.3.0',
          },
        ],
        total: 1,
        offset: 0,
        limit: 50,
      }).success,
    ).toBe(true);
    expect(
      DiffCoverageStatusSchema.safeParse({
        projectId: 'p',
        commit: 'abc1234',
        branch: 'main',
        state: 'waiting-for-coverage',
        result: null,
      }).success,
    ).toBe(true);
    expect(
      DiffCoverageStatusSchema.safeParse({
        projectId: 'p',
        commit: 'abc1234',
        branch: 'main',
        state: 'computed',
        result: {
          covered: 1,
          executable: 2,
          ratio: 1.5,
          uncovered: [],
          unmeasuredFiles: [],
          computedAt: '2026-10-23T12:00:00.000Z',
        },
      }).success,
    ).toBe(false);
  });
});
