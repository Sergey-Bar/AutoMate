/**
 * ImpactedTests.tsx — Panel showing tests impacted by changed files
 *
 * Calls POST /api/tests/impacted with changed file paths, displays results,
 * and offers a "Run impacted only" CTA to trigger a filtered test run.
 */
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { startRun } from '@/hooks/useRun';
import { safeMotion, fadeSlideUp, stagger } from '@/lib/motion';

interface ImpactedTest {
  testFile: string;
  title: string;
  reason: string;
}

interface ImpactedTestsProps {
  changedFiles: string[];
}

export function ImpactedTests({ changedFiles }: ImpactedTestsProps) {
  const impactMutation = useMutation({
    mutationFn: async (files: string[]) => {
      const res = await fetch('/api/tests/impacted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedFiles: files }),
      });
      if (!res.ok) throw new Error('Failed to analyze test impact');
      return res.json() as Promise<ImpactedTest[]>;
    },
  });
  const analyzeImpact = impactMutation.mutate;

  const runMutation = useMutation({
    mutationFn: async (tests: ImpactedTest[]) => {
      const grepPattern = tests.map((t) => t.title).join('|');
      return startRun({ grep: grepPattern });
    },
  });

  useEffect(() => {
    if (changedFiles.length > 0) {
      analyzeImpact(changedFiles);
    }
  }, [analyzeImpact, changedFiles]);

  if (impactMutation.isIdle || impactMutation.isPending) {
    return (
      <div className="p-4 rounded-xl border border-border-default bg-bg-surface">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 animate-spin text-text-secondary" viewBox="0 0 24 24" fill="none">
            <title>Loading impact analysis</title>
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
            />
          </svg>
          <span className="text-sm text-text-secondary">
            Analyzing test impact…
          </span>
        </div>
      </div>
    );
  }

  if (impactMutation.isError) {
    return (
      <div className="p-4 rounded-xl border border-border-default bg-bg-surface text-sm text-text-secondary">
        Could not analyze test impact.
      </div>
    );
  }

  const tests = impactMutation.data;
  if (!tests || tests.length === 0) return null;

  return (
    <motion.div
      className="rounded-xl border border-border-default overflow-hidden bg-bg-surface"
      initial="hidden"
      animate="visible"
      variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold bg-running text-white">
            {tests.length}
          </span>
          <span className="text-sm font-medium text-text-primary">
            {tests.length === 1 ? '1 test impacted' : `${tests.length} tests impacted`} by your
            changes
          </span>
        </div>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-running text-white"
          disabled={runMutation.isPending}
          onClick={() => runMutation.mutate(tests)}
        >
          {runMutation.isPending ? 'Starting…' : 'Run impacted only'}
        </button>
      </div>

      {/* Test list */}
      <motion.ul
        className="divide-y divide-border-subtle"
        variants={safeMotion(stagger.list) as import('framer-motion').Variants}
        initial="hidden"
        animate="visible"
      >
        {tests.map((test) => (
          <motion.li
            key={test.testFile}
            className="px-4 py-2.5 flex items-start gap-3"
            variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
          >
            <span className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 bg-running" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate text-text-primary">
                {test.title}
              </p>
              <p className="text-xs truncate text-text-tertiary">
                {test.testFile}
              </p>
              <p className="text-xs mt-0.5 text-text-secondary">
                {test.reason}
              </p>
            </div>
          </motion.li>
        ))}
      </motion.ul>

      {runMutation.isError && (
        <div className="px-4 py-2 text-xs border-t border-border-subtle text-text-secondary">
          Failed to start run. Please try again.
        </div>
      )}
    </motion.div>
  );
}
