/**
 * AiExplainButton.tsx — AI-powered test failure explanation button
 *
 * Shows a "✦ Explain" button that calls the AI service to analyze test failures.
 * Displays loading state and result card with summary + suggestion.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { safeMotion, fadeSlideUp } from '@/lib/motion';
import { useFeatureStore } from '@/store/featureStore';
import { cn } from '@/lib/utils';

interface AiExplainButtonProps {
  error: string;
  stack?: string;
  testCode?: string;
}

interface ExplainResponse {
  summary: string;
  suggestion: string;
  confidence: number;
  criticConfidence?: number;
  critique?: string;
  validated?: boolean;
}

export function AiExplainButton({ error, stack, testCode }: AiExplainButtonProps) {
  const aiEnabled = useFeatureStore((s) => s.flags['ai-explain']);
  const [showResult, setShowResult] = useState(false);

  const explainMutation = useMutation({
    mutationFn: async (payload: { error: string; stack?: string; testCode?: string }) => {
      const response = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error: string; details?: string };
        throw new Error(errorData.error || 'Failed to get AI explanation');
      }

      return response.json() as Promise<ExplainResponse>;
    },
    onSuccess: () => {
      setShowResult(true);
    },
  });

  if (aiEnabled === false) return null;

  const handleExplain = () => {
    setShowResult(false);
    explainMutation.mutate({ error, stack, testCode });
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      {/* Button */}
      <button
        type="button"
        onClick={handleExplain}
        disabled={explainMutation.isPending}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-border text-text-primary bg-bg-surface transition-colors',
          'hover:bg-bg-hover hover:border-border-focus',
          explainMutation.isPending ? 'cursor-wait' : 'cursor-pointer',
        )}
      >
        {explainMutation.isPending ? (
          <>
            <svg
              style={{
                width: '1rem',
                height: '1rem',
                animation: 'spin 1s linear infinite',
              }}
              viewBox="0 0 24 24"
              fill="none"
            >
              <title>Loading</title>
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="32 32"
                opacity="0.3"
              />
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="16 32"
                opacity="1"
              />
            </svg>
            Analyzing...
          </>
        ) : (
          <>
            <span className="text-lg">✦</span>
            Explain
          </>
        )}
      </button>

      {/* CSS keyframes for spinner */}
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>

      {/* Error Message */}
      {explainMutation.isError && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
          className="mt-4 px-4 py-3 bg-bg-error text-text-error border border-border-error rounded-md text-sm"
        >
          <strong>Error:</strong> {explainMutation.error.message}
        </motion.div>
      )}

      {/* Result Card */}
      {showResult && explainMutation.data && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
          className="mt-4 p-4 bg-bg-surface border border-border rounded-lg text-sm leading-[1.6]"
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-3 text-text-secondary text-xs font-semibold uppercase tracking-[0.05em]">
            <span className="text-base">✦</span>
            AI Analysis
            <span className="ml-auto px-2 py-0.5 bg-bg-hover rounded">
              {Math.round(explainMutation.data.confidence * 100)}% confidence
            </span>
          </div>

          {/* Confidence bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-secondary">Confidence</span>
              <span className="text-xs font-medium">
                {Math.round(explainMutation.data.confidence * 100)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  explainMutation.data.confidence < 0.5
                    ? 'bg-red-500'
                    : explainMutation.data.confidence < 0.7
                    ? 'bg-yellow-500'
                    : 'bg-green-500',
                )}
                style={{ width: `${Math.round(explainMutation.data.confidence * 100)}%` }}
              />
            </div>
          </div>

          {/* Low confidence warning */}
          {explainMutation.data.validated === false && (
            <div className="mb-3 flex items-center gap-1.5 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
              <span>⚠️</span>
              <span>Low confidence — AI diagnosis may be inaccurate</span>
            </div>
          )}

          {/* Summary */}
          <div style={{ marginBottom: '1rem' }}>
            <h4
              className="text-xs font-semibold uppercase tracking-[0.05em] text-text-secondary mb-2"
            >
              Summary
            </h4>
            <p className="text-text-primary m-0">
              {explainMutation.data.summary}
            </p>
          </div>

          {/* Suggestion */}
          <div>
            <h4
              className="text-xs font-semibold uppercase tracking-[0.05em] text-text-secondary mb-2"
            >
              Suggestion
            </h4>
            <div
              className="p-3 bg-bg-code border border-border rounded-md text-text-code"
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.8125rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {explainMutation.data.suggestion}
            </div>
          </div>

          {/* Critic's note */}
          {explainMutation.data.critique && (
            <details className="mt-3 text-xs text-text-secondary">
              <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary">
                Critic&apos;s note
              </summary>
              <p className="mt-1 leading-relaxed">{explainMutation.data.critique}</p>
            </details>
          )}
        </motion.div>
      )}
    </div>
  );
}
