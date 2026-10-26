import { describe, expect, it } from 'vitest';
import {
  DeliveryMarkersSchema,
  DeliverySourceBodySchema,
  GitHubWebhookAckSchema,
  PushDeploymentBodySchema,
  PushIncidentBodySchema,
} from './delivery.js';
import { HealthPolicySchema } from './health.js';

describe('the delivery source body', () => {
  it('fills the defaults a first save leaves out', () => {
    expect(DeliverySourceBodySchema.parse({ enabled: true })).toEqual({
      enabled: true,
      cadence: 'daily',
      productionEnvironments: ['production'],
      deployWorkflows: [],
    });
    expect(DeliveryMarkersSchema.parse({})).toEqual({
      rollbackLabels: ['rollback', 'revert'],
      hotfixLabels: ['hotfix'],
      rollbackBranchPrefixes: ['revert-'],
      hotfixBranchPrefixes: ['hotfix/'],
    });
  });

  it('refuses an unknown cadence, an empty environment list and a field it does not know', () => {
    for (const body of [
      { enabled: true, cadence: 'weekly' },
      { enabled: true, productionEnvironments: [] },
      { enabled: true, token: 'ghp_x' },
    ]) {
      expect(DeliverySourceBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('the push door', () => {
  const deployment = {
    externalId: 'deploy-1',
    environment: 'production',
    status: 'success',
    createdAt: '2026-10-20T10:00:00Z',
  };

  it('accepts a deployment and lower-cases its commits', () => {
    const parsed = PushDeploymentBodySchema.parse({
      ...deployment,
      sha: 'ABCDEF1',
      shas: ['ABCDEF1', 'abcdef2'],
    });
    expect(parsed.sha).toBe('abcdef1');
    expect(parsed.shas).toEqual(['abcdef1', 'abcdef2']);
  });

  it('refuses a deployment with a status, commit or time it cannot read', () => {
    for (const body of [
      { ...deployment, status: 'pending' },
      { ...deployment, sha: 'not-a-sha' },
      { ...deployment, createdAt: 'yesterday' },
      { ...deployment, author: 'someone' },
    ]) {
      expect(PushDeploymentBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('accepts an incident open, resolved, or with no resolution field at all', () => {
    const incident = { externalId: 'INC-1', openedAt: '2026-10-20T10:00:00Z', title: 'Down' };
    expect(PushIncidentBodySchema.parse(incident).source).toBe('push');
    expect(PushIncidentBodySchema.safeParse({ ...incident, resolvedAt: null }).success).toBe(true);
    expect(
      PushIncidentBodySchema.safeParse({ ...incident, resolvedAt: '2026-10-20T11:00:00Z' }).success,
    ).toBe(true);
  });

  it('refuses an incident resolved before it opened, and a source that is not a slug', () => {
    const incident = { externalId: 'INC-1', openedAt: '2026-10-20T10:00:00Z', title: 'Down' };
    expect(
      PushIncidentBodySchema.safeParse({ ...incident, resolvedAt: '2026-10-20T09:00:00Z' }).success,
    ).toBe(false);
    expect(PushIncidentBodySchema.safeParse({ ...incident, source: 'Pager Duty' }).success).toBe(
      false,
    );
  });
});

describe('the delivery policy', () => {
  it('rides in the health policy, and refuses a failure rate written as a percentage', () => {
    const parsed = HealthPolicySchema.parse({
      delivery: { maxChangeFailureRate: 0.15, gateOnDelivery: true, staleAfterDays: 5 },
    });
    expect(parsed.delivery?.gateOnDelivery).toBe(true);
    expect(HealthPolicySchema.safeParse({ delivery: { maxChangeFailureRate: 15 } }).success).toBe(
      false,
    );
  });
});

describe('the webhook acknowledgement', () => {
  it('names why nothing was queued', () => {
    expect(
      GitHubWebhookAckSchema.parse({
        status: 'ignored',
        event: 'star',
        reason: 'event',
        queued: 0,
      }).reason,
    ).toBe('event');
  });
});
