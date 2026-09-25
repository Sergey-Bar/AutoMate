/**
 * Targeted mutation-killing tests for jira/src/index.ts
 *
 * Surviving Stryker mutants:
 * - name: 'jira' → ''
 * - version: '0.1.0' → ''
 * - displayName: 'Jira' → ''
 * - description → ''
 * - icon: 'jira' → ''
 * - credentialSchema fields → {}
 * - tool name 'create_issue' → ''
 * - create_issue inputSchema → {}
 * - search_issues: (data.issues ?? []) → ["Stryker was here"] (ArrayDeclaration mutant)
 * - search_issues maxResults default 'Bug' → ''  
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@automate/connector-sdk';
import { jiraManifest } from './index.js';

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function createCtx(overrides?: Partial<Record<string, string>>): ToolContext {
  return {
    credentials: {
      baseUrl: 'https://test.atlassian.net',
      email: 'user@test.com',
      apiToken: 'test-token',
      projectKey: 'TEST',
      ...overrides,
    },
    abortSignal: new AbortController().signal,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('jiraManifest — manifest field mutation killers', () => {
  it('manifest name is exactly "jira" — kills StringLiteral mutant', () => {
    expect(jiraManifest.name).toBe('jira');
    expect(jiraManifest.name).not.toBe('');
  });

  it('manifest version is exactly "0.1.0" — kills StringLiteral mutant', () => {
    expect(jiraManifest.version).toBe('0.1.0');
    expect(jiraManifest.version).not.toBe('');
  });

  it('manifest displayName is exactly "Jira" — kills StringLiteral mutant', () => {
    expect(jiraManifest.displayName).toBe('Jira');
    expect(jiraManifest.displayName).not.toBe('');
  });

  it('manifest description is non-empty — kills StringLiteral mutant', () => {
    expect(jiraManifest.description).toBeTruthy();
    expect(jiraManifest.description).not.toBe('');
    expect(jiraManifest.description).toContain('Jira');
  });

  it('manifest icon is exactly "jira" — kills StringLiteral mutant', () => {
    expect(jiraManifest.icon).toBe('jira');
    expect(jiraManifest.icon).not.toBe('');
  });

  it('first tool name is "create_issue" — kills StringLiteral mutant', () => {
    const tool = jiraManifest.tools.find((t) => t.name === 'create_issue');
    expect(tool).toBeDefined();
    expect(tool!.name).not.toBe('');
  });

  it('second tool name is "search_issues" — kills StringLiteral mutant', () => {
    const tool = jiraManifest.tools.find((t) => t.name === 'search_issues');
    expect(tool).toBeDefined();
    expect(tool!.name).not.toBe('');
  });

  // Kills ObjectLiteral mutant: credentialSchema → {}
  it('credentialSchema requires baseUrl, email, apiToken, projectKey — kills ObjectLiteral mutant', () => {
    const schema = jiraManifest.credentialSchema;

    const valid = schema.safeParse({
      baseUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'secret',
      projectKey: 'PROJ',
    });
    expect(valid.success).toBe(true);

    // Each individual missing field must cause failure
    expect(schema.safeParse({ email: 'x@y.com', apiToken: 'tok', projectKey: 'K' }).success).toBe(false);
    expect(schema.safeParse({ baseUrl: 'https://x.atlassian.net', apiToken: 'tok', projectKey: 'K' }).success).toBe(false);
    expect(schema.safeParse({ baseUrl: 'https://x.atlassian.net', email: 'x@y.com', projectKey: 'K' }).success).toBe(false);
    expect(schema.safeParse({ baseUrl: 'https://x.atlassian.net', email: 'x@y.com', apiToken: 'tok' }).success).toBe(false);
  });

  // Kills ObjectLiteral mutant: create_issue inputSchema → {}
  it('create_issue inputSchema requires summary and description — kills ObjectLiteral mutant', () => {
    const tool = jiraManifest.tools.find((t) => t.name === 'create_issue')!;

    const valid = tool.inputSchema.safeParse({ summary: 'Bug', description: 'Details' });
    expect(valid.success).toBe(true);

    const missingSummary = tool.inputSchema.safeParse({ description: 'Details' });
    expect(missingSummary.success).toBe(false);

    const missingDescription = tool.inputSchema.safeParse({ summary: 'Bug' });
    expect(missingDescription.success).toBe(false);
  });

  // Kills StringLiteral mutant: issueType default 'Bug' → ''
  it('create_issue issueType defaults to "Bug" not empty string — kills StringLiteral mutant', () => {
    const tool = jiraManifest.tools.find((t) => t.name === 'create_issue')!;
    const result = tool.inputSchema.safeParse({ summary: 'Test', description: 'Desc' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { issueType: string }).issueType).toBe('Bug');
      expect((result.data as { issueType: string }).issueType).not.toBe('');
    }
  });

  // Kills ArrayDeclaration mutant: (data.issues ?? []) → ["Stryker was here"]
  // When API returns no issues or data.issues is undefined/null, result should be empty
  it('search_issues returns empty text for null issues response — kills ArrayDeclaration mutant', async () => {
    const searchTool = jiraManifest.tools.find((t) => t.name === 'search_issues')!;
    const ctx = createCtx();

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ issues: null }),
    });

    const result = await searchTool.handler({ jql: 'project = TEST', maxResults: 10 }, ctx);
    expect(result.content[0]).toBeDefined();
    const text = (result.content[0] as { type: string; text: string }).text;

    // With ArrayDeclaration mutant ["Stryker was here"], the result would be:
    // 'undefined: undefined' or similar (mapping over ["Stryker was here"])
    // With correct code: null ?? [] = [] → empty → 'No issues found'
    expect(text).toBe('No issues found');
    expect(text).not.toContain('Stryker');
  });

  it('search_issues returns empty text for undefined issues in response — kills ArrayDeclaration mutant', async () => {
    const searchTool = jiraManifest.tools.find((t) => t.name === 'search_issues')!;
    const ctx = createCtx();

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}), // no issues property at all
    });

    const result = await searchTool.handler({ jql: 'project = TEST', maxResults: 5 }, ctx);
    const text = (result.content[0] as { type: string; text: string }).text;

    // undefined ?? [] = [] → 'No issues found'
    // ["Stryker was here"] → maps string to 'Stryker was here: undefined' 
    expect(text).toBe('No issues found');
    expect(text).not.toContain('Stryker was here');
  });

  // Kills ObjectLiteral mutant: search_issues inputSchema → {}
  it('search_issues inputSchema requires jql — kills ObjectLiteral mutant', () => {
    const tool = jiraManifest.tools.find((t) => t.name === 'search_issues')!;

    const valid = tool.inputSchema.safeParse({ jql: 'project = TEST' });
    expect(valid.success).toBe(true);

    const missing = tool.inputSchema.safeParse({});
    expect(missing.success).toBe(false);
  });

  // Kills StringLiteral mutant in search_issues: maxResults default 10 → ''
  it('search_issues maxResults defaults to 10 — confirms StringLiteral default', () => {
    const tool = jiraManifest.tools.find((t) => t.name === 'search_issues')!;
    const result = tool.inputSchema.safeParse({ jql: 'project = X' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { maxResults: number }).maxResults).toBe(10);
    }
  });
});
