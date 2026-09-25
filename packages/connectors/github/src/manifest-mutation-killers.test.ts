/**
 * Targeted mutation-killing tests for github/src/index.ts
 *
 * Surviving Stryker mutants (StringLiteral and ObjectLiteral in manifest):
 * - name: 'github' → ''
 * - version: '0.1.0' → ''
 * - displayName: 'GitHub' → ''
 * - description string → ''
 * - icon: 'github' → ''
 * - tool name 'create_issue' → ''
 * - tool name 'post_pr_comment' → ''
 * - credentialSchema z.object({...}) → {}
 * - create_issue inputSchema → {}
 * - post_pr_comment inputSchema → {}
 */
import { describe, expect, it } from 'vitest';
import { githubManifest } from './index.js';

describe('githubManifest — manifest field mutation killers', () => {
  it('manifest name is exactly "github" — kills StringLiteral mutant', () => {
    expect(githubManifest.name).toBe('github');
    expect(githubManifest.name).not.toBe('');
    expect(githubManifest.name.length).toBeGreaterThan(0);
  });

  it('manifest version is exactly "0.1.0" — kills StringLiteral mutant', () => {
    expect(githubManifest.version).toBe('0.1.0');
    expect(githubManifest.version).not.toBe('');
  });

  it('manifest displayName is exactly "GitHub" — kills StringLiteral mutant', () => {
    expect(githubManifest.displayName).toBe('GitHub');
    expect(githubManifest.displayName).not.toBe('');
  });

  it('manifest description is non-empty and mentions GitHub — kills StringLiteral mutant', () => {
    expect(githubManifest.description).toBeTruthy();
    expect(githubManifest.description).not.toBe('');
    expect(githubManifest.description).toContain('GitHub');
  });

  it('manifest icon is exactly "github" — kills StringLiteral mutant', () => {
    expect(githubManifest.icon).toBe('github');
    expect(githubManifest.icon).not.toBe('');
  });

  it('first tool name is exactly "create_issue" — kills StringLiteral mutant', () => {
    const tool = githubManifest.tools.find((t) => t.name === 'create_issue');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('create_issue');
    expect(tool!.name).not.toBe('');
  });

  it('second tool name is exactly "post_pr_comment" — kills StringLiteral mutant', () => {
    const tool = githubManifest.tools.find((t) => t.name === 'post_pr_comment');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('post_pr_comment');
    expect(tool!.name).not.toBe('');
  });

  // Kills ObjectLiteral mutant: credentialSchema replaced with {}
  // An empty schema accepts everything — specific fields must be validated
  it('credentialSchema requires token, owner, and repo — kills ObjectLiteral mutant', () => {
    const schema = githubManifest.credentialSchema;

    // Valid case
    const valid = schema.safeParse({ token: 'ghp_abc', owner: 'myorg', repo: 'myrepo' });
    expect(valid.success).toBe(true);

    // Missing token → must fail with real schema, would pass with {}
    const missingToken = schema.safeParse({ owner: 'myorg', repo: 'myrepo' });
    expect(missingToken.success).toBe(false);

    // Missing owner → must fail
    const missingOwner = schema.safeParse({ token: 'ghp_abc', repo: 'myrepo' });
    expect(missingOwner.success).toBe(false);

    // Missing repo → must fail
    const missingRepo = schema.safeParse({ token: 'ghp_abc', owner: 'myorg' });
    expect(missingRepo.success).toBe(false);

    // Empty object → must fail
    const empty = schema.safeParse({});
    expect(empty.success).toBe(false);
  });

  // Kills ObjectLiteral mutant: create_issue inputSchema replaced with {}
  it('create_issue inputSchema requires title and body — kills ObjectLiteral mutant', () => {
    const tool = githubManifest.tools.find((t) => t.name === 'create_issue')!;

    const valid = tool.inputSchema.safeParse({ title: 'Bug', body: 'Details' });
    expect(valid.success).toBe(true);

    // Missing body → must fail with real schema
    const missingBody = tool.inputSchema.safeParse({ title: 'Bug' });
    expect(missingBody.success).toBe(false);

    // Missing title → must fail
    const missingTitle = tool.inputSchema.safeParse({ body: 'Details' });
    expect(missingTitle.success).toBe(false);
  });

  // Kills ObjectLiteral mutant: post_pr_comment inputSchema replaced with {}
  it('post_pr_comment inputSchema requires pull_number and body — kills ObjectLiteral mutant', () => {
    const tool = githubManifest.tools.find((t) => t.name === 'post_pr_comment')!;

    const valid = tool.inputSchema.safeParse({ pull_number: 42, body: 'LGTM' });
    expect(valid.success).toBe(true);

    // Missing pull_number → must fail with real schema
    const missingPR = tool.inputSchema.safeParse({ body: 'LGTM' });
    expect(missingPR.success).toBe(false);

    // Missing body → must fail
    const missingBody = tool.inputSchema.safeParse({ pull_number: 42 });
    expect(missingBody.success).toBe(false);
  });
});
