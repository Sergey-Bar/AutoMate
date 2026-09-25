import type { RunResultCallback } from '../routes/run-callback.js';

export interface TriageFailureResult {
  testTitle: string;
  file?: string;
  errorMessage?: string;
  rootCause: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TriageResult {
  runId: string;
  analyzedAt: string;
  failures: TriageFailureResult[];
  summary: string;
}

export const triageResults = new Map<string, TriageResult>();

interface OllamaGenerateResponse {
  response: string;
}

interface ParsedAnalysis {
  rootCause: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

const FALLBACK_ANALYSIS: ParsedAnalysis = {
  rootCause: 'Unable to analyze - AI service unavailable',
  suggestedFix: 'Check error message manually',
  confidence: 'low',
};

function extractJson(text: string): ParsedAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return FALLBACK_ANALYSIS;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const rootCause = typeof parsed.rootCause === 'string' ? parsed.rootCause : null;
    const suggestedFix = typeof parsed.suggestedFix === 'string' ? parsed.suggestedFix : null;
    const rawConfidence = parsed.confidence;
    const confidence =
      rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
        ? rawConfidence
        : 'low';

    if (!rootCause || !suggestedFix) return FALLBACK_ANALYSIS;

    return { rootCause, suggestedFix, confidence };
  } catch {
    return FALLBACK_ANALYSIS;
  }
}

async function analyzeTestFailure(
  test: { title: string; file?: string; errorMessage?: string },
  ollamaHost: string,
  model: string,
): Promise<ParsedAnalysis> {
  const prompt = `Analyze this Playwright test failure and provide a root cause and suggested fix.

Test: ${test.title}
File: ${test.file ?? 'unknown'}
Error: ${test.errorMessage ?? 'no error message'}

Respond in JSON: { "rootCause": "...", "suggestedFix": "...", "confidence": "high|medium|low" }`;

  try {
    const response = await fetch(`${ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    if (!response.ok) return FALLBACK_ANALYSIS;

    const data = await response.json() as OllamaGenerateResponse;
    return extractJson(data.response ?? '');
  } catch {
    return FALLBACK_ANALYSIS;
  }
}

export async function triageFailedRun(
  runResult: RunResultCallback,
  options: { ollamaHost?: string; model?: string },
): Promise<TriageResult> {
  const ollamaHost = options.ollamaHost ?? 'http://localhost:11434';
  const model = options.model ?? 'llama3.1';

  const failedTests = runResult.failedTests ?? [];

  if (runResult.failed === 0 || failedTests.length === 0) {
    const emptyResult: TriageResult = {
      runId: runResult.runId,
      analyzedAt: new Date().toISOString(),
      failures: [],
      summary: 'No failures to analyze.',
    };
    triageResults.set(runResult.runId, emptyResult);
    return emptyResult;
  }

  const failures: TriageFailureResult[] = await Promise.all(
    failedTests.map(async (test) => {
      const analysis = await analyzeTestFailure(test, ollamaHost, model);
      return {
        testTitle: test.title,
        file: test.file,
        errorMessage: test.errorMessage,
        rootCause: analysis.rootCause,
        suggestedFix: analysis.suggestedFix,
        confidence: analysis.confidence,
      };
    }),
  );

  const highCount = failures.filter((f) => f.confidence === 'high').length;
  const lowCount = failures.filter((f) => f.confidence === 'low').length;
  const summary =
    `Analyzed ${failures.length} failed test(s). ` +
    `${highCount} high-confidence root cause(s) identified. ` +
    `${lowCount > 0 ? `${lowCount} could not be analyzed automatically.` : 'All tests analyzed.'}`;

  const result: TriageResult = {
    runId: runResult.runId,
    analyzedAt: new Date().toISOString(),
    failures,
    summary,
  };

  triageResults.set(runResult.runId, result);
  return result;
}

export async function getTriageForRun(runId: string): Promise<TriageResult | undefined> {
  return triageResults.get(runId);
}
