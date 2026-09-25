/**
 * apps/server/src/services/test-generator.ts — NL → Playwright test generation service
 *
 * Converts a natural-language description into a fully-formed, valid
 * TypeScript Playwright test file, with validation and confidence scoring.
 */

import { getAiProvider } from './ai-provider-registry.js';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface GenerateTestInput {
  description: string;
  baseUrl?: string;
  framework?: 'playwright';
}

export interface GenerateTestResult {
  code: string;
  filename: string;
  confidence: number;
  warnings: string[];
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(input: GenerateTestInput): string {
  const lines = [
    'You are a Playwright test automation expert.',
    'Write a complete TypeScript Playwright test for the following scenario:',
    '',
    `"${input.description}"`,
    '',
  ];

  if (input.baseUrl) {
    lines.push(`The base URL is: ${input.baseUrl}`, '');
  }

  lines.push(
    'Requirements:',
    "- Start with: import { test, expect } from '@playwright/test';",
    '- Use accessibility-first selectors: page.getByRole(), page.getByLabel(), page.getByText()',
    '- Each test must have a descriptive name',
    '- Use async/await throughout',
    '- Include proper assertions with expect()',
    '- Do not import any non-Playwright modules',
    '- Return ONLY the TypeScript code, no explanation',
    '',
    'Output the code in a typescript code block.',
  );

  return lines.join('\n');
}

// ── Code fence stripper ───────────────────────────────────────────────────────

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```typescript\s*/i, '')
    .replace(/^```ts\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// ── Filename deriver ──────────────────────────────────────────────────────────

function deriveFilename(code: string): string {
  const match = code.match(/test\(\s*['"`]([^'"`]+)['"`]/);
  if (match?.[1]) {
    const title = match[1]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return `${title}.spec.ts`;
  }
  return 'generated-test.spec.ts';
}

// ── Validator ─────────────────────────────────────────────────────────────────

function validateCode(code: string): string[] {
  const warnings: string[] = [];

  if (!code.includes("import { test, expect } from '@playwright/test'")) {
    warnings.push('Missing Playwright imports');
  }

  if (!code.includes('test(')) {
    warnings.push('No test function found');
  }

  if (/\beval\s*\(/.test(code)) {
    warnings.push('Forbidden code pattern: eval()');
  }

  if (/\brequire\s*\(/.test(code)) {
    warnings.push('Forbidden code pattern: require()');
  }

  if (/\bprocess\.exit\s*\(/.test(code)) {
    warnings.push('Forbidden code pattern: process.exit()');
  }

  return warnings;
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generate(input: GenerateTestInput): Promise<GenerateTestResult> {
  if (!input.description.trim()) {
    throw new Error('description is required');
  }

  // Get configured AI provider — throws 'No AI provider configured' if not set up
  const { config, adapter } = await getAiProvider();

  // Build prompt and call AI
  const prompt = buildPrompt(input);
  const raw = await adapter.createCompletion(prompt, config);

  // Strip code fences
  const code = stripCodeFences(raw);

  // Validate
  const warnings = validateCode(code);

  // Compute confidence: start at 1.0, subtract 0.2 per warning, clamp to [0, 1]
  const confidence = Math.max(0, Math.min(1, 1.0 - warnings.length * 0.2));

  // Derive filename
  const filename = deriveFilename(code);

  return { code, filename, confidence, warnings };
}
