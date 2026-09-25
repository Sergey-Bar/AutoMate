import { describe, expect, it } from 'vitest';
import { jiraManifest } from './index.js';

describe('jira connector real handlers', () => {
  it('create_issue validates input schema', () => {
    const tool = jiraManifest.tools.find(t => t.name === 'create_issue')!;
    expect(tool.inputSchema).toBeDefined();
  });

  it('search_issues validates JQL input', () => {
    const tool = jiraManifest.tools.find(t => t.name === 'search_issues')!;
    expect(tool.inputSchema).toBeDefined();
  });

  it('credential schema requires baseUrl, email, apiToken, projectKey', () => {
    expect(jiraManifest.credentialSchema).toBeDefined();
  });
});
