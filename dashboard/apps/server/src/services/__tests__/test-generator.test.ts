import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock ai-provider-registry ─────────────────────────────────────────────────

const mockGetAiProvider = vi.hoisted(() => vi.fn());

vi.mock('../ai-provider-registry.js', () => ({
  getAiProvider: mockGetAiProvider,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(content: string) {
  return {
    config: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' },
    adapter: {
      name: 'openai',
      createCompletion: vi.fn().mockResolvedValue(content),
      validate: vi.fn().mockReturnValue(true),
    },
  };
}

const VALID_CODE = `import { test, expect } from '@playwright/test';

test('log in as admin and verify dashboard', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('secret');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});`;

const FENCED_CODE = `\`\`\`typescript\n${VALID_CODE}\n\`\`\``;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('test-generator service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns code, filename, confidence 1.0, no warnings', async () => {
    mockGetAiProvider.mockResolvedValue(makeAdapter(VALID_CODE));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'log in as admin and verify dashboard' });

    expect(result.code).toBe(VALID_CODE);
    expect(result.filename).toMatch(/\.spec\.ts$/);
    expect(result.confidence).toBe(1.0);
    expect(result.warnings).toEqual([]);
  });

  it('strips markdown code fences from response', async () => {
    mockGetAiProvider.mockResolvedValue(makeAdapter(FENCED_CODE));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'verify something' });

    expect(result.code).toBe(VALID_CODE);
    expect(result.code).not.toContain('```');
  });

  it('warning: missing Playwright import reduces confidence by 0.2', async () => {
    const codeWithoutImport = VALID_CODE.replace(
      "import { test, expect } from '@playwright/test';",
      "import { test, expect } from '@playwright/test'; // removed",
    ).replace("import { test, expect } from '@playwright/test'; // removed", '');

    mockGetAiProvider.mockResolvedValue(makeAdapter(codeWithoutImport));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'some test' });

    expect(result.warnings).toContain('Missing Playwright imports');
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it('warning: eval() in code adds forbidden pattern warning', async () => {
    const codeWithEval = `import { test, expect } from '@playwright/test';\n\ntest('bad test', async ({ page }) => {\n  eval('something');\n  await expect(page).toBeTruthy();\n});`;
    mockGetAiProvider.mockResolvedValue(makeAdapter(codeWithEval));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'test with eval' });

    expect(result.warnings).toContain('Forbidden code pattern: eval()');
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it('warning: require() in code adds forbidden pattern warning', async () => {
    const codeWithRequire = `import { test, expect } from '@playwright/test';\n\nconst fs = require('fs');\n\ntest('require test', async ({ page }) => {\n  await expect(page).toBeTruthy();\n});`;
    mockGetAiProvider.mockResolvedValue(makeAdapter(codeWithRequire));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'test with require' });

    expect(result.warnings).toContain('Forbidden code pattern: require()');
  });

  it('warning: missing test() call adds warning', async () => {
    const codeNoTest = `import { test, expect } from '@playwright/test';\n\n// no test function here\nconst x = 1;`;
    mockGetAiProvider.mockResolvedValue(makeAdapter(codeNoTest));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'empty test' });

    expect(result.warnings).toContain('No test function found');
  });

  it('multiple warnings clamp confidence to 0.0, not negative', async () => {
    // Missing import + no test() + eval + require + process.exit = 5 warnings → confidence 0
    const badCode = `// no import\neval('x');\nrequire('fs');\nprocess.exit(1);`;
    mockGetAiProvider.mockResolvedValue(makeAdapter(badCode));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'bad generated test' });

    expect(result.confidence).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(5);
  });

  it('provider error (no provider configured) propagates — does not swallow', async () => {
    mockGetAiProvider.mockRejectedValue(new Error('No AI provider configured'));

    const { generate } = await import('../test-generator.js');

    await expect(generate({ description: 'some test' })).rejects.toThrow('No AI provider configured');
  });

  it('empty description throws an error', async () => {
    const { generate } = await import('../test-generator.js');

    await expect(generate({ description: '' })).rejects.toThrow('description is required');
    await expect(generate({ description: '   ' })).rejects.toThrow('description is required');
  });

  it('derives filename from first test() title', async () => {
    const code = `import { test, expect } from '@playwright/test';\n\ntest('log in as admin user', async ({ page }) => {\n  await expect(page).toBeTruthy();\n});`;
    mockGetAiProvider.mockResolvedValue(makeAdapter(code));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'login test' });

    expect(result.filename).toBe('log-in-as-admin-user.spec.ts');
  });

  it('uses fallback filename when no test() title found', async () => {
    const code = `import { test, expect } from '@playwright/test';\n\n// no test call`;
    mockGetAiProvider.mockResolvedValue(makeAdapter(code));

    const { generate } = await import('../test-generator.js');
    const result = await generate({ description: 'something' });

    expect(result.filename).toBe('generated-test.spec.ts');
  });

  it('includes baseUrl in prompt when provided', async () => {
    const adapterConfig = makeAdapter(VALID_CODE);
    mockGetAiProvider.mockResolvedValue(adapterConfig);

    const { generate } = await import('../test-generator.js');
    await generate({ description: 'verify login', baseUrl: 'https://my-app.example.com' });

    const createCompletionCall = adapterConfig.adapter.createCompletion.mock.calls[0];
    expect(createCompletionCall).toBeDefined();
    const prompt = createCompletionCall?.[0] as string;
    expect(prompt).toContain('https://my-app.example.com');
  });

  it('does not include baseUrl section when not provided', async () => {
    const adapterConfig = makeAdapter(VALID_CODE);
    mockGetAiProvider.mockResolvedValue(adapterConfig);

    const { generate } = await import('../test-generator.js');
    await generate({ description: 'verify login' });

    const createCompletionCall = adapterConfig.adapter.createCompletion.mock.calls[0];
    expect(createCompletionCall).toBeDefined();
    const prompt = createCompletionCall?.[0] as string;
    expect(prompt).not.toContain('The base URL is:');
  });
});
