import { useState, useCallback } from 'react';

export const aiGenerateApiPath = '/api/ai/generate-test';

export type AIGenerateStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AIGenerateResult {
  code: string;
  explanation: string;
}

export interface AIGenerateState {
  status: AIGenerateStatus;
  result: AIGenerateResult | null;
  error: string | null;
}

export interface UseAIGenerateReturn extends AIGenerateState {
  generate: (prompt: string, targetUrl: string) => Promise<void>;
  reset: () => void;
}

const initialState: AIGenerateState = {
  status: 'idle',
  result: null,
  error: null,
};

export function useAIGenerate(): UseAIGenerateReturn {
  const [state, setState] = useState<AIGenerateState>(initialState);

  const generate = useCallback(async (prompt: string, targetUrl: string) => {
    if (!prompt.trim()) return;

    setState({ status: 'loading', result: null, error: null });

    try {
      const res = await fetch(aiGenerateApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, targetUrl }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as AIGenerateResult;
      setState({ status: 'success', result: data, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setState({ status: 'error', result: null, error: msg });
    }
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { ...state, generate, reset };
}
