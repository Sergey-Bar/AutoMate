import { describe, expect, it } from 'vitest';
import { firstProductionCarriers, type DoraDeployment } from './dora.js';

const deployment = (
  id: string,
  createdAt: string,
  extra: Partial<DoraDeployment> = {},
): DoraDeployment => ({
  id,
  environment: 'production',
  status: 'success',
  createdAt,
  sha: null,
  ...extra,
});

describe('firstProductionCarriers', () => {
  it('names the first production deployment that carried each commit, and DORA’s verdict on it', () => {
    const carriers = firstProductionCarriers({
      deployments: [
        deployment('d2', '2026-10-02T00:00:00Z', { shas: ['b'], sha: 'c' }),
        deployment('d1', '2026-10-01T00:00:00Z', { shas: ['a'] }),
        deployment('s1', '2026-09-30T00:00:00Z', { environment: 'staging', shas: ['a', 'b'] }),
      ],
      incidents: [
        { id: 'i1', openedAt: '2026-10-02T01:00:00Z', resolvedAt: null, deploymentId: 'd2' },
      ],
      productionEnvironments: ['Production'],
    });
    expect(Object.fromEntries(carriers)).toEqual({
      a: { deploymentId: 'd1', failed: false, at: '2026-10-01T00:00:00.000Z' },
      b: { deploymentId: 'd2', failed: true, at: '2026-10-02T00:00:00.000Z' },
      c: { deploymentId: 'd2', failed: true, at: '2026-10-02T00:00:00.000Z' },
    });
  });

  it('applies DORA’s remediation rule: a hotfix fails the latest earlier deployment that shipped something new', () => {
    const carriers = firstProductionCarriers({
      deployments: [
        deployment('d1', '2026-10-01T00:00:00Z', { shas: ['a'] }),
        // A redeploy of `a` ships nothing new, so the hotfix cannot blame it.
        deployment('d2', '2026-10-01T06:00:00Z', { shas: ['a'] }),
        deployment('d3', '2026-10-01T12:00:00Z', { shas: ['fix'], hotfix: true }),
      ],
      incidents: [],
      productionEnvironments: ['production'],
    });
    expect(carriers.get('a')).toMatchObject({ deploymentId: 'd1', failed: true });
    expect(carriers.get('fix')).toMatchObject({ deploymentId: 'd3', failed: false });
  });

  it('counts a failed deployment as the first carrier, since DORA counts it as a change failure', () => {
    const carriers = firstProductionCarriers({
      deployments: [
        deployment('d1', '2026-10-01T00:00:00Z', { shas: ['a'], status: 'failure' }),
        deployment('d2', '2026-10-01T01:00:00Z', { shas: ['a'] }),
      ],
      incidents: [],
      productionEnvironments: ['production'],
    });
    expect(carriers.get('a')).toMatchObject({ deploymentId: 'd1', failed: true });
  });
});
