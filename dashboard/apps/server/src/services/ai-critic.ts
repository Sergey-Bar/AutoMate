/**
 * ai-critic.ts — Critic pass for dual-agent RCA
 */
import type { AiProviderConfig } from '@automate/dashboard-shared';
import { providerRegistry } from './ai-provider-registry.js';

const DEFAULT_CRITIC_TIMEOUT_MS = 5000;

export interface CriticInput {
  error: string;
  stack?: string;
  testCode?: string;
  analyzerSummary: string;
  analyzerSuggestion: string;
  config: AiProviderConfig;
  timeoutMs?: number;
}

export interface CriticResult {
  validated: boolean;
  adjustedSummary?: string;
  adjustedSuggestion?: string;
  confidence: number;
  critique: string;
}

export async function runCritic(input: CriticInput): Promise<CriticResult> {
  const {
    error, stack, testCode, analyzerSummary, analyzerSuggestion, config,
    timeoutMs = DEFAULT_CRITIC_TIMEOUT_MS,
  } = input;

  const adapter = providerRegistry.getAdapter(config.provider);
  if (!adapter) {
    return { validated: false, confidence: 0.5, critique: 'Critic unavailable: provider not found' };
  }

  const prompt = buildCriticPrompt({ error, stack, testCode, analyzerSummary, analyzerSuggestion });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('critic timeout')), timeoutMs),
  );

  let rawResponse: string;
  try {
    rawResponse = await Promise.race([adapter.createCompletion(prompt, config), timeoutPromise]);
  } catch (err) {
    if ((err as Error).message === 'critic timeout') {
      return { validated: false, confidence: 0.5, critique: 'Validation timed out' };
    }
    return { validated: false, confidence: 0.5, critique: `Critic failed: ${(err as Error).message}` };
  }

  return parseCriticResponse(rawResponse);
}

function buildCriticPrompt(params: {
  error: string;
  stack?: string;
  testCode?: string;
  analyzerSummary: string;
  analyzerSuggestion: string;
}): string {
  const { error, stack, testCode, analyzerSummary, analyzerSuggestion } = params;
  const parts = [
    'You are a QA engineer reviewing an AI diagnosis of a test failure.',
    '',
    'ORIGINAL FAILURE:',
    `Error: ${error}`,
  ];
  if (stack) parts.push(`Stack: ${stack.split('\n').slice(0, 5).join('\n')}`);
  if (testCode) parts.push(`Test code: ${testCode.slice(0, 300)}`);
  parts.push(
    '',
    'AI DIAGNOSIS:',
    `Summary: ${analyzerSummary}`,
    `Suggestion: ${analyzerSuggestion}`,
    '',
    'YOUR TASK:',
    '1. Does the summary accurately describe what went wrong based on the error and stack trace?',
    '2. Is the suggestion actionable and likely to fix the issue?',
    '3. Did the analyzer miss any obvious causes visible in the error/stack?',
    '4. Rate your confidence (0.0-1.0) that the diagnosis is correct.',
    '',
    'Respond ONLY in JSON: { "validated": bool, "adjustedSummary": "...", "adjustedSuggestion": "...", "confidence": 0.X, "critique": "..." }',
  );
  return parts.join('\n');
}

function parseCriticResponse(raw: string): CriticResult {
  try {
    // Extract JSON from response (may have markdown fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]) as {
      validated?: unknown;
      adjustedSummary?: unknown;
      adjustedSuggestion?: unknown;
      confidence?: unknown;
      critique?: unknown;
    };
    return {
      validated: typeof parsed.validated === 'boolean' ? parsed.validated : false,
      adjustedSummary: typeof parsed.adjustedSummary === 'string' ? parsed.adjustedSummary : undefined,
      adjustedSuggestion: typeof parsed.adjustedSuggestion === 'string' ? parsed.adjustedSuggestion : undefined,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      critique: typeof parsed.critique === 'string' ? parsed.critique : 'No critique provided',
    };
  } catch {
    return { validated: false, confidence: 0.5, critique: 'Critic response could not be parsed' };
  }
}
