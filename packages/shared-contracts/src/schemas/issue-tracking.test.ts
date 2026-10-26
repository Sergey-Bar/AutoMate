import { describe, expect, it } from 'vitest';
import {
  ClusterIssueBodySchema,
  FindingIssueBodySchema,
  IssueLinkSchema,
  IssueTrackerBodySchema,
  IssueTrackerReadingSchema,
  IssueTrackerSchema,
} from './issue-tracking.js';

describe('the issue tracker body', () => {
  it('defaults the kind and issue type, and keeps the token optional', () => {
    expect(
      IssueTrackerBodySchema.parse({ baseUrl: ' https://acme.atlassian.net ', projectKey: 'ACME' }),
    ).toEqual({
      kind: 'jira',
      baseUrl: 'https://acme.atlassian.net',
      projectKey: 'ACME',
      issueType: 'Bug',
    });
  });

  it.each([
    ['http://acme.atlassian.net', 'plain http carries the token in clear text'],
    ['https://user:pass@acme.atlassian.net', 'credentials in the URL'],
    ['not a url', 'not a URL'],
  ])('refuses the base URL %s (%s)', (baseUrl) => {
    expect(IssueTrackerBodySchema.safeParse({ baseUrl, projectKey: 'ACME' }).success).toBe(false);
  });

  it('refuses a project key Jira would not accept, and an empty token', () => {
    const base = { baseUrl: 'https://acme.atlassian.net' };
    expect(IssueTrackerBodySchema.safeParse({ ...base, projectKey: 'acme' }).success).toBe(false);
    expect(IssueTrackerBodySchema.safeParse({ ...base, projectKey: '1ACME' }).success).toBe(false);
    expect(
      IssueTrackerBodySchema.safeParse({ ...base, projectKey: 'ACME', token: '' }).success,
    ).toBe(false);
  });

  it('has no field on the read side that could carry the token', () => {
    const tracker = {
      projectId: 'p',
      kind: 'jira',
      baseUrl: 'https://acme.atlassian.net',
      projectKey: 'ACME',
      issueType: 'Bug',
      hasCredential: true,
      updatedBy: 'a',
      updatedAt: '2026-10-26T12:00:00.000Z',
    };
    expect(IssueTrackerSchema.parse({ ...tracker, token: 'leak' })).not.toHaveProperty('token');
    expect(IssueTrackerReadingSchema.parse({ tracker: null })).toEqual({ tracker: null });
  });
});

describe('issue creation bodies', () => {
  it('names the target, never guesses it', () => {
    expect(FindingIssueBodySchema.safeParse({}).success).toBe(false);
    expect(FindingIssueBodySchema.parse({ target: 'github' })).toEqual({ target: 'github' });
    expect(FindingIssueBodySchema.safeParse({ target: 'linear' }).success).toBe(false);
  });

  it('bounds a cluster and defaults its lists', () => {
    const cluster = {
      projectId: '00000000-0000-4000-8000-000000000001',
      target: 'jira',
      signature: 'TypeError: x',
      sampleMessage: 'TypeError: x',
      count: 3,
      runs: 2,
    };
    expect(ClusterIssueBodySchema.parse(cluster)).toMatchObject({ tests: [], branches: [] });
    expect(ClusterIssueBodySchema.safeParse({ ...cluster, count: 0 }).success).toBe(false);
    expect(
      ClusterIssueBodySchema.safeParse({ ...cluster, tests: Array.from({ length: 51 }, () => 't') })
        .success,
    ).toBe(false);
    expect(ClusterIssueBodySchema.safeParse({ ...cluster, projectId: 'p' }).success).toBe(false);
  });

  it('reads back a link', () => {
    const link = {
      id: 'l',
      projectId: 'p',
      sourceKind: 'cluster',
      sourceKey: 'k',
      target: 'jira',
      key: 'ACME-1',
      url: 'https://acme.atlassian.net/browse/ACME-1',
      created: false,
      createdBy: 'a',
      createdAt: '2026-10-26T12:00:00.000Z',
    };
    expect(IssueLinkSchema.parse(link)).toEqual(link);
  });
});
