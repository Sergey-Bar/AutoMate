import { create } from 'zustand';
import type { Run, Test } from '@/lib/types';

interface LiveRunState {
  /** Currently watching run ID */
  activeRunId: string | null;
  run: Partial<Run> | null;
  /** tests keyed by testId */
  tests: Record<string, Test>;
  /** stdout/stderr chunks accumulated */
  terminalOutput: string[];
  /** worker gantt: workerIndex → current test title */
  workerMap: Record<number, { testId: string; title: string; startedAt: number } | null>;

  // Actions
  setActiveRun: (runId: string | null) => void;
  applyRunStart: (payload: Partial<Run>) => void;
  applyTestBegin: (test: Partial<Test>) => void;
  applyTestEnd: (testId: string, update: Partial<Test>) => void;
  appendTerminal: (chunk: string) => void;
  clearTerminal: () => void;
  applyRunEnd: (update: Partial<Run>) => void;
  reset: () => void;
}

export const useRunStore = create<LiveRunState>((set) => ({
  activeRunId: null,
  run: null,
  tests: {},
  terminalOutput: [],
  workerMap: {},

  setActiveRun: (runId) => set({ activeRunId: runId }),

  applyRunStart: (payload) =>
    set((s) => ({
      run: { ...s.run, ...payload, status: 'running' },
    })),

  applyTestBegin: (test) =>
    set((s) => ({
      tests: {
        ...s.tests,
        [test.id!]: { ...s.tests[test.id!], ...test, status: 'running' } as Test,
      },
      workerMap: test.workerIndex != null
        ? {
            ...s.workerMap,
            [test.workerIndex]: {
              testId: test.id!,
              title: test.title ?? '',
              startedAt: Date.now(),
            },
          }
        : s.workerMap,
    })),

  applyTestEnd: (testId, update) =>
    set((s) => {
      const prev = s.tests[testId];
      const workerMap = { ...s.workerMap };
      // Clear worker slot
      if (prev?.workerIndex != null) workerMap[prev.workerIndex] = null;
      return {
        tests: { ...s.tests, [testId]: { ...prev, ...update } as Test },
        workerMap,
        run: s.run
          ? {
              ...s.run,
              passed:  update.status === 'passed'  ? (s.run.passed  ?? 0) + 1 : s.run.passed,
              failed:  (update.status === 'failed' || update.status === 'timedOut') ? (s.run.failed ?? 0) + 1 : s.run.failed,
              flaky:   update.status === 'flaky'   ? (s.run.flaky   ?? 0) + 1 : s.run.flaky,
              skipped: update.status === 'skipped' ? (s.run.skipped ?? 0) + 1 : s.run.skipped,
            }
          : s.run,
      };
    }),

  appendTerminal: (chunk) =>
    set((s) => ({
      terminalOutput:
        s.terminalOutput.length > 10_000
          ? [...s.terminalOutput.slice(-5_000), chunk]
          : [...s.terminalOutput, chunk],
    })),

  clearTerminal: () => set({ terminalOutput: [] }),

  applyRunEnd: (update) =>
    set((s) => ({ run: { ...s.run, ...update } })),

  reset: () =>
    set({ run: null, tests: {}, terminalOutput: [], workerMap: {}, activeRunId: null }),
}));
