import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GeneratedTest } from './ai-test-gen.js';

// Mock the 'ai' module BEFORE importing the service
const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: mockGenerateText,
}));

// Mock feature-flags so we can control the gate
const mockIsEnabled = vi.fn();
vi.mock('./feature-flags.js', () => ({
  isEnabled: mockIsEnabled,
}));

// Import AFTER mocks are set up
const { generateTestsFromSource, generateTestsFromDiff, generateTestsFromRequirement } = await import('./ai-test-gen.js');

const MOCK_TEST_OUTPUT = `describe("add", () => {
  it("adds two numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
  it("handles negative numbers", () => {
    expect(add(-1, -1)).toBe(-2);
  });
});`;

const MOCK_MODEL = {} as Parameters<typeof generateTestsFromSource>[2];

const SOURCE_WITH_EXPORTED_FUNCTION = `
export function add(a: number, b: number): number {
  return a + b;
}
`;

const SOURCE_WITH_MULTIPLE_EXPORTS = `
/**
 * Multiplies two numbers.
 */
export function multiply(x: number, y: number): number {
  return x * y;
}

export const subtract = (a: number, b: number): number => a - b;

export async function fetchData(url: string): Promise<string> {
  const res = await fetch(url);
  return res.text();
}

// Not exported — should be excluded
function privateHelper(val: string): string {
  return val.trim();
}
`;

const SOURCE_WITH_CLASS = `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  static create(): Calculator {
    return new Calculator();
  }
}
`;

describe('generateTestsFromSource', () => {
  beforeEach(() => {
    mockIsEnabled.mockReturnValue(true);
    mockGenerateText.mockResolvedValue({ text: MOCK_TEST_OUTPUT });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when feature flag ai-test-gen is disabled', async () => {
    mockIsEnabled.mockReturnValue(false);

    await expect(
      generateTestsFromSource(SOURCE_WITH_EXPORTED_FUNCTION, 'add.ts', MOCK_MODEL),
    ).rejects.toThrow("Feature 'ai-test-gen' is not enabled");
  });

  it('calls generateText with system and user prompts', async () => {
    await generateTestsFromSource(SOURCE_WITH_EXPORTED_FUNCTION, 'add.ts', MOCK_MODEL);

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0] as {
      model: unknown;
      system: string;
      prompt: string;
    };
    expect(callArgs.system).toContain('Vitest tests');
    expect(callArgs.system).toContain('describe/it pattern');
    expect(callArgs.prompt).toContain('add.ts');
  });

  it('returns the LLM text as testCode', async () => {
    const result: GeneratedTest = await generateTestsFromSource(
      SOURCE_WITH_EXPORTED_FUNCTION,
      'src/utils/add.ts',
      MOCK_MODEL,
    );

    expect(result.testCode).toBe(MOCK_TEST_OUTPUT);
  });

  describe('testFileName derivation', () => {
    it('derives test file name from simple path: foo.ts → foo.test.ts', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'foo.ts',
        MOCK_MODEL,
      );
      expect(result.testFileName).toBe('foo.test.ts');
    });

    it('derives test file name from nested path: bar/baz.ts → baz.test.ts', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'bar/baz.ts',
        MOCK_MODEL,
      );
      expect(result.testFileName).toBe('baz.test.ts');
    });

    it('handles Windows-style paths: src\\utils\\add.ts → add.test.ts', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'src\\utils\\add.ts',
        MOCK_MODEL,
      );
      expect(result.testFileName).toBe('add.test.ts');
    });
  });

  describe('AST extraction — exported functions', () => {
    it('extracts exported function names into functionsAnalyzed', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'add.ts',
        MOCK_MODEL,
      );

      expect(result.functionsAnalyzed).toContain('add');
    });

    it('does NOT include function body in the prompt', async () => {
      await generateTestsFromSource(SOURCE_WITH_EXPORTED_FUNCTION, 'add.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      // Body token
      expect(callArgs.prompt).not.toContain('return a + b');
    });

    it('includes parameter types in the signature sent to LLM', async () => {
      await generateTestsFromSource(SOURCE_WITH_EXPORTED_FUNCTION, 'add.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('a: number');
      expect(callArgs.prompt).toContain('b: number');
    });

    it('includes return type in the signature sent to LLM', async () => {
      await generateTestsFromSource(SOURCE_WITH_EXPORTED_FUNCTION, 'add.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('number');
    });

    it('includes function name "add" in the signature sent to LLM', async () => {
      await generateTestsFromSource(SOURCE_WITH_EXPORTED_FUNCTION, 'add.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('add');
    });
  });

  describe('AST extraction — multiple exports', () => {
    it('extracts all exported function names', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_MULTIPLE_EXPORTS,
        'math.ts',
        MOCK_MODEL,
      );

      expect(result.functionsAnalyzed).toContain('multiply');
      expect(result.functionsAnalyzed).toContain('subtract');
      expect(result.functionsAnalyzed).toContain('fetchData');
    });

    it('does NOT include non-exported functions', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_MULTIPLE_EXPORTS,
        'math.ts',
        MOCK_MODEL,
      );

      expect(result.functionsAnalyzed).not.toContain('privateHelper');
    });

    it('includes JSDoc comment in prompt for annotated functions', async () => {
      await generateTestsFromSource(SOURCE_WITH_MULTIPLE_EXPORTS, 'math.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain('Multiplies two numbers');
    });

    it('does NOT include function bodies for arrow functions', async () => {
      await generateTestsFromSource(SOURCE_WITH_MULTIPLE_EXPORTS, 'math.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      // Arrow function body literal
      expect(callArgs.prompt).not.toContain('a - b');
    });
  });

  describe('AST extraction — class methods', () => {
    it('extracts class method signatures', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_CLASS,
        'calculator.ts',
        MOCK_MODEL,
      );

      expect(result.functionsAnalyzed).toContain('Calculator.add');
      expect(result.functionsAnalyzed).toContain('Calculator.create');
    });

    it('does NOT include class method bodies in prompt', async () => {
      await generateTestsFromSource(SOURCE_WITH_CLASS, 'calculator.ts', MOCK_MODEL);

      const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).not.toContain('return a + b');
      expect(callArgs.prompt).not.toContain('new Calculator()');
    });
  });

  describe('GeneratedTest shape', () => {
    it('returns all required fields', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'add.ts',
        MOCK_MODEL,
      );

      expect(result).toHaveProperty('testCode');
      expect(result).toHaveProperty('testFileName');
      expect(result).toHaveProperty('functionsAnalyzed');
      expect(result).toHaveProperty('prompt');
    });

    it('includes filePath in prompt field', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'src/utils/add.ts',
        MOCK_MODEL,
      );

      expect(result.prompt).toContain('src/utils/add.ts');
    });

    it('functionsAnalyzed is an array of strings', async () => {
      const result = await generateTestsFromSource(
        SOURCE_WITH_EXPORTED_FUNCTION,
        'add.ts',
        MOCK_MODEL,
      );

      expect(Array.isArray(result.functionsAnalyzed)).toBe(true);
      for (const fn of result.functionsAnalyzed) {
        expect(typeof fn).toBe('string');
      }
    });
  });
});

const MOCK_DIFF = `--- a/src/utils/add.ts
+++ b/src/utils/add.ts
@@ -0,0 +1,3 @@
+export function add(a: number, b: number): number {
+  return a + b;
+}`;

const MOCK_REQUIREMENT = 'As a user, I want to add two numbers so that I can see the sum.';

const MOCK_MODEL_V2 = {} as Parameters<typeof generateTestsFromDiff>[1];

describe('generateTestsFromDiff', () => {
  beforeEach(() => {
    mockIsEnabled.mockReturnValue(true);
    mockGenerateText.mockResolvedValue({ text: 'it("should work", () => {})' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when feature flag ai-test-gen-v2 is disabled', async () => {
    mockIsEnabled.mockReturnValue(false);

    await expect(
      generateTestsFromDiff({ diff: MOCK_DIFF }, MOCK_MODEL_V2),
    ).rejects.toThrow("Feature 'ai-test-gen-v2' is not enabled");
  });

  it('returns correct sourceType pr_diff', async () => {
    const result = await generateTestsFromDiff({ diff: MOCK_DIFF }, MOCK_MODEL_V2);
    expect(result.sourceType).toBe('pr_diff');
  });

  it('returns testCode from LLM', async () => {
    const result = await generateTestsFromDiff({ diff: MOCK_DIFF }, MOCK_MODEL_V2);
    expect(result.testCode).toBe('it("should work", () => {})');
  });

  it('returns empty warnings for small input', async () => {
    const result = await generateTestsFromDiff({ diff: MOCK_DIFF }, MOCK_MODEL_V2);
    expect(result.warnings).toEqual([]);
  });

  it('truncates and warns when diff exceeds 30KB', async () => {
    const largeDiff = 'x'.repeat(40 * 1024); // 40KB
    const result = await generateTestsFromDiff({ diff: largeDiff }, MOCK_MODEL_V2);
    expect(result.warnings).toContain('Input truncated to 30KB limit');

    // Verify the prompt was bounded
    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    const promptBytes = Buffer.byteLength(callArgs.prompt, 'utf8');
    expect(promptBytes).toBeLessThanOrEqual(30720);
  });

  it('passes language and framework hints to system prompt', async () => {
    await generateTestsFromDiff(
      { diff: MOCK_DIFF, language: 'JavaScript', framework: 'Jest' },
      MOCK_MODEL_V2,
    );

    const callArgs = mockGenerateText.mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('JavaScript');
    expect(callArgs.system).toContain('Jest');
  });

  it('includes filePath hint in user prompt when provided', async () => {
    await generateTestsFromDiff(
      { diff: MOCK_DIFF, filePath: 'src/utils/add.ts' },
      MOCK_MODEL_V2,
    );

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain('src/utils/add.ts');
  });

  it('does not include filePath in prompt when not provided', async () => {
    await generateTestsFromDiff({ diff: MOCK_DIFF }, MOCK_MODEL_V2);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).not.toContain('File:');
  });

  it('does not modify generateTestsFromSource (existing tests still pass)', async () => {
    mockIsEnabled.mockImplementation((flag: string) => flag === 'ai-test-gen');
    const result = await generateTestsFromSource(
      'export function add(a: number, b: number): number { return a + b; }',
      'add.ts',
      {} as Parameters<typeof generateTestsFromDiff>[1],
    );
    expect(result).toHaveProperty('testFileName');
    expect(result).toHaveProperty('functionsAnalyzed');
  });
});

describe('generateTestsFromRequirement', () => {
  beforeEach(() => {
    mockIsEnabled.mockReturnValue(true);
    mockGenerateText.mockResolvedValue({ text: 'it("should satisfy requirement", () => {})' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when feature flag ai-test-gen-v2 is disabled', async () => {
    mockIsEnabled.mockReturnValue(false);

    await expect(
      generateTestsFromRequirement({ requirement: MOCK_REQUIREMENT }, MOCK_MODEL_V2),
    ).rejects.toThrow("Feature 'ai-test-gen-v2' is not enabled");
  });

  it('returns correct sourceType requirement', async () => {
    const result = await generateTestsFromRequirement(
      { requirement: MOCK_REQUIREMENT },
      MOCK_MODEL_V2,
    );
    expect(result.sourceType).toBe('requirement');
  });

  it('returns testCode from LLM', async () => {
    const result = await generateTestsFromRequirement(
      { requirement: MOCK_REQUIREMENT },
      MOCK_MODEL_V2,
    );
    expect(result.testCode).toBe('it("should satisfy requirement", () => {})');
  });

  it('returns empty warnings for small input', async () => {
    const result = await generateTestsFromRequirement(
      { requirement: MOCK_REQUIREMENT },
      MOCK_MODEL_V2,
    );
    expect(result.warnings).toEqual([]);
  });

  it('truncates and warns when requirement exceeds 30KB', async () => {
    const largeReq = 'r'.repeat(40 * 1024); // 40KB
    const result = await generateTestsFromRequirement({ requirement: largeReq }, MOCK_MODEL_V2);
    expect(result.warnings).toContain('Input truncated to 30KB limit');

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    const promptBytes = Buffer.byteLength(callArgs.prompt, 'utf8');
    expect(promptBytes).toBeLessThanOrEqual(30720);
  });

  it('passes language and framework hints to system prompt', async () => {
    await generateTestsFromRequirement(
      { requirement: MOCK_REQUIREMENT, language: 'Python', framework: 'pytest' },
      MOCK_MODEL_V2,
    );

    const callArgs = mockGenerateText.mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('Python');
    expect(callArgs.system).toContain('pytest');
  });

  it('uses TypeScript and Vitest as defaults', async () => {
    await generateTestsFromRequirement({ requirement: MOCK_REQUIREMENT }, MOCK_MODEL_V2);

    const callArgs = mockGenerateText.mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('TypeScript');
    expect(callArgs.system).toContain('Vitest');
  });
});
