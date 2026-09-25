import * as ts from 'typescript';
import { generateText } from 'ai';
import { isEnabled } from './feature-flags.js';

/** 30KB limit (in bytes) for LLM input */
const MAX_INPUT_BYTES = 30720;

export interface GeneratedTestV2 {
  testCode: string;
  sourceType: 'pr_diff' | 'requirement';
  warnings: string[];
  modelProvider?: string;
  modelName?: string;
}

export interface GeneratedTest {
  testCode: string;
  testFileName: string;
  functionsAnalyzed: string[];
  prompt: string;
}

interface ExtractedSignature {
  name: string;
  signature: string;
  jsDoc?: string;
}

/**
 * Walks a TypeScript AST and extracts exported function/arrow function signatures
 * and class method signatures — WITHOUT including function bodies.
 */
function extractSignatures(sourceCode: string, sourceFile: ts.SourceFile): ExtractedSignature[] {
  const signatures: ExtractedSignature[] = [];

  function getJsDoc(node: ts.Node): string | undefined {
    const fullText = sourceCode;
    const nodeStart = node.getFullStart();
    const nodeTextStart = node.getStart(sourceFile);
    const leadingText = fullText.slice(nodeStart, nodeTextStart);
    const jsDocMatch = leadingText.match(/\/\*\*[\s\S]*?\*\//);
    return jsDocMatch ? jsDocMatch[0].trim() : undefined;
  }

  function getParamsText(params: ts.NodeArray<ts.ParameterDeclaration>): string {
    return params.map((p) => p.getText(sourceFile)).join(', ');
  }

  function getReturnTypeText(typeNode: ts.TypeNode | undefined): string {
    return typeNode ? typeNode.getText(sourceFile) : 'void';
  }

  function hasExportModifier(node: ts.HasModifiers): boolean {
    return (
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    );
  }

  function visit(node: ts.Node): void {
    // Exported function declarations: export function foo(...): ReturnType {}
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      const params = getParamsText(node.parameters);
      const returnType = getReturnTypeText(node.type);
      const signature = `export function ${node.name.text}(${params}): ${returnType}`;
      signatures.push({
        name: node.name.text,
        signature,
        jsDoc: getJsDoc(node),
      });
    }

    // Exported async function declarations
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      // Already handled above — skip duplicate
    }

    // Exported variable statements with arrow functions:
    // export const foo = (...): ReturnType => ...
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          const fn = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;
          const params = getParamsText(fn.parameters);
          const returnType = getReturnTypeText(fn.type);
          const signature = `export const ${decl.name.text} = (${params}): ${returnType} => ...`;
          signatures.push({
            name: decl.name.text,
            signature,
            jsDoc: getJsDoc(node),
          });
        }
      }
    }

    // Class methods in exported classes
    if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          ts.isIdentifier(member.name)
        ) {
          const params = getParamsText(member.parameters);
          const returnType = getReturnTypeText(member.type);
          const isStatic = member.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.StaticKeyword,
          ) ?? false;
          const isAsync = member.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
          ) ?? false;
          const modifiers = [
            isStatic ? 'static' : '',
            isAsync ? 'async' : '',
          ].filter(Boolean).join(' ');
          const modStr = modifiers ? `${modifiers} ` : '';
          const signature = `${node.name.text}.${modStr}${member.name.text}(${params}): ${returnType}`;
          signatures.push({
            name: `${node.name.text}.${member.name.text}`,
            signature,
            jsDoc: getJsDoc(member),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return signatures;
}

/**
 * Derives the test file name from the source file path.
 * e.g., "foo.ts" → "foo.test.ts", "bar/baz.ts" → "baz.test.ts"
 */
function deriveTestFileName(filePath: string): string {
  // Normalize to forward slashes and get basename
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? filePath;
  // Replace extension: foo.ts → foo.test.ts, foo.tsx → foo.test.tsx
  return basename.replace(/(\.[^.]+)$/, '.test$1');
}

/**
 * Generates Vitest tests for a TypeScript source file using an LLM.
 *
 * - Requires feature flag 'ai-test-gen' to be enabled
 * - Extracts exported function signatures via the TypeScript compiler API (no bodies sent to LLM)
 * - Calls the LLM via Vercel AI SDK generateText()
 *
 * @param sourceCode  - Full TypeScript source code of the module
 * @param filePath    - Original file path (used to derive test file name and as context)
 * @param model       - Vercel AI SDK model instance (injected for testability)
 */
export async function generateTestsFromSource(
  sourceCode: string,
  filePath: string,
  model: Parameters<typeof generateText>[0]['model'],
): Promise<GeneratedTest> {
  if (!isEnabled('ai-test-gen')) {
    throw new Error("Feature 'ai-test-gen' is not enabled");
  }

  // Parse source and extract signatures (no bodies)
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const extracted = extractSignatures(sourceCode, sourceFile);

  // Build condensed representation for LLM
  const condensed = extracted
    .map((sig) => (sig.jsDoc ? `${sig.jsDoc}\n${sig.signature}` : sig.signature))
    .join('\n\n');

  const systemPrompt =
    'Generate Vitest tests for the following TypeScript module. Use describe/it pattern. Mock external dependencies. Test happy path and error cases.';

  const userPrompt = `${condensed}\n\nFile: ${filePath}`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  return {
    testCode: text,
    testFileName: deriveTestFileName(filePath),
    functionsAnalyzed: extracted.map((sig) => sig.name),
    prompt: userPrompt,
  };
}

/**
 * Generates Vitest tests from a PR/git diff using an LLM.
 *
 * - Requires feature flag 'ai-test-gen-v2' to be enabled
 * - Truncates diff to 30KB if needed, adding a warning
 * - Builds a diff-specific prompt (not the same as generateTestsFromSource)
 *
 * @param options.diff        - The unified diff content (e.g., from `git diff`)
 * @param options.filePath    - Optional file path hint for context
 * @param options.language    - Optional language hint (default: TypeScript)
 * @param options.framework   - Optional test framework hint (default: Vitest)
 * @param model               - Vercel AI SDK model instance (injected for testability)
 */
export async function generateTestsFromDiff(
  options: { diff: string; filePath?: string; language?: string; framework?: string },
  model: Parameters<typeof generateText>[0]['model'],
): Promise<GeneratedTestV2> {
  if (!isEnabled('ai-test-gen-v2')) {
    throw new Error("Feature 'ai-test-gen-v2' is not enabled");
  }

  const warnings: string[] = [];

  let diff = options.diff;
  const diffBytes = Buffer.byteLength(diff, 'utf8');
  if (diffBytes > MAX_INPUT_BYTES) {
    diff = Buffer.from(diff, 'utf8').slice(0, MAX_INPUT_BYTES).toString('utf8');
    warnings.push('Input truncated to 30KB limit');
  }

  const language = options.language ?? 'TypeScript';
  const framework = options.framework ?? 'Vitest';
  const fileHint = options.filePath ? `\nFile: ${options.filePath}` : '';

  const systemPrompt = `You are an expert ${language} developer. Generate ${framework} tests for the changes in the following diff. Focus on testing the added/modified behaviour. Use describe/it pattern. Mock external dependencies. Test happy path and edge cases.`;

  const userPrompt = `${diff}${fileHint}`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  return {
    testCode: text,
    sourceType: 'pr_diff',
    warnings,
  };
}

/**
 * Generates Vitest tests from a natural language requirement using an LLM.
 *
 * - Requires feature flag 'ai-test-gen-v2' to be enabled
 * - Truncates requirement to 30KB if needed, adding a warning
 * - Builds a requirement-specific prompt (not the same as generateTestsFromSource)
 *
 * @param options.requirement - The requirement text or user story
 * @param options.language    - Optional language hint (default: TypeScript)
 * @param options.framework   - Optional test framework hint (default: Vitest)
 * @param model               - Vercel AI SDK model instance (injected for testability)
 */
export async function generateTestsFromRequirement(
  options: { requirement: string; language?: string; framework?: string },
  model: Parameters<typeof generateText>[0]['model'],
): Promise<GeneratedTestV2> {
  if (!isEnabled('ai-test-gen-v2')) {
    throw new Error("Feature 'ai-test-gen-v2' is not enabled");
  }

  const warnings: string[] = [];

  let requirement = options.requirement;
  const reqBytes = Buffer.byteLength(requirement, 'utf8');
  if (reqBytes > MAX_INPUT_BYTES) {
    requirement = Buffer.from(requirement, 'utf8').slice(0, MAX_INPUT_BYTES).toString('utf8');
    warnings.push('Input truncated to 30KB limit');
  }

  const language = options.language ?? 'TypeScript';
  const framework = options.framework ?? 'Vitest';

  const systemPrompt = `You are an expert ${language} developer. Generate ${framework} tests that verify the following requirement. Use describe/it pattern. Include acceptance criteria as test cases. Test both success scenarios and failure conditions.`;

  const userPrompt = requirement;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  return {
    testCode: text,
    sourceType: 'requirement',
    warnings,
  };
}
