/// <reference types="vitest" />
import { describe, it, expect, beforeEach } from 'vitest';
import { useRunStore } from './runStore';

describe('runStore', () => {
  beforeEach(() => {
    useRunStore.setState({
      activeRunId: null,
      run: null,
      tests: {},
      terminalOutput: [],
      workerMap: {},
    });
  });

  describe('initial state', () => {
    it('starts with null/empty values', () => {
      const state = useRunStore.getState();
      expect(state.activeRunId).toBeNull();
      expect(state.run).toBeNull();
      expect(state.tests).toEqual({});
      expect(state.terminalOutput).toEqual([]);
      expect(state.workerMap).toEqual({});
    });
  });

  describe('setActiveRun', () => {
    it('sets the active run id', () => {
      useRunStore.getState().setActiveRun('run-1');
      expect(useRunStore.getState().activeRunId).toBe('run-1');
    });

    it('can set to null', () => {
      useRunStore.getState().setActiveRun('run-1');
      useRunStore.getState().setActiveRun(null);
      expect(useRunStore.getState().activeRunId).toBeNull();
    });
  });

  describe('applyRunStart', () => {
    it('sets run with status running', () => {
      useRunStore.getState().applyRunStart({ id: 'run-1', total: 10 });
      const run = useRunStore.getState().run;
      expect(run).toBeDefined();
      expect(run?.id).toBe('run-1');
      expect(run?.total).toBe(10);
      expect(run?.status).toBe('running');
    });

    it('merges with existing run data', () => {
      useRunStore.getState().applyRunStart({ id: 'run-1', total: 10 });
      useRunStore.getState().applyRunStart({ total: 20 });
      const run = useRunStore.getState().run;
      expect(run?.id).toBe('run-1');
      expect(run?.total).toBe(20);
    });
  });

  describe('applyTestBegin', () => {
    it('adds a test with running status', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-1',
        title: 'Login test',
        workerIndex: 0,
      });
      const tests = useRunStore.getState().tests;
      expect(tests['test-1']).toBeDefined();
      expect(tests['test-1'].status).toBe('running');
      expect(tests['test-1'].title).toBe('Login test');
    });

    it('updates workerMap when workerIndex is provided', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-1',
        title: 'Login test',
        workerIndex: 2,
      });
      const workerMap = useRunStore.getState().workerMap;
      expect(workerMap[2]).toBeDefined();
      expect(workerMap[2]?.testId).toBe('test-1');
      expect(workerMap[2]?.title).toBe('Login test');
    });

    it('does not update workerMap when workerIndex is null', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-1',
        title: 'Test',
        workerIndex: null,
      });
      expect(useRunStore.getState().workerMap).toEqual({});
    });

    it('falls back to empty string when title is not provided', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-no-title',
        workerIndex: 1,
      });
      const workerMap = useRunStore.getState().workerMap;
      expect(workerMap[1]?.title).toBe('');
    });
  });

  describe('applyTestEnd', () => {
    beforeEach(() => {
      useRunStore.getState().applyRunStart({ id: 'run-1', total: 5 });
    });

    it('updates test status', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-1',
        title: 'Test A',
        workerIndex: 0,
      });
      useRunStore.getState().applyTestEnd('test-1', { status: 'passed' });
      expect(useRunStore.getState().tests['test-1'].status).toBe('passed');
    });

    it('increments passed counter', () => {
      useRunStore.getState().applyTestBegin({ id: 'test-1', title: 'A', workerIndex: 0 });
      useRunStore.getState().applyTestEnd('test-1', { status: 'passed' });
      expect(useRunStore.getState().run?.passed).toBe(1);
    });

    it('increments failed counter for failed status', () => {
      useRunStore.getState().applyTestBegin({ id: 'test-1', title: 'A', workerIndex: 0 });
      useRunStore.getState().applyTestEnd('test-1', { status: 'failed' });
      expect(useRunStore.getState().run?.failed).toBe(1);
    });

    it('increments failed counter for timedOut status', () => {
      useRunStore.getState().applyTestBegin({ id: 'test-1', title: 'A', workerIndex: 0 });
      useRunStore.getState().applyTestEnd('test-1', { status: 'timedOut' });
      expect(useRunStore.getState().run?.failed).toBe(1);
    });

    it('increments flaky counter', () => {
      useRunStore.getState().applyTestBegin({ id: 'test-1', title: 'A', workerIndex: 0 });
      useRunStore.getState().applyTestEnd('test-1', { status: 'flaky' });
      expect(useRunStore.getState().run?.flaky).toBe(1);
    });

    it('increments skipped counter', () => {
      useRunStore.getState().applyTestBegin({ id: 'test-1', title: 'A', workerIndex: 0 });
      useRunStore.getState().applyTestEnd('test-1', { status: 'skipped' });
      expect(useRunStore.getState().run?.skipped).toBe(1);
    });

    it('clears worker slot on test end', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-1',
        title: 'A',
        workerIndex: 0,
      });
      expect(useRunStore.getState().workerMap[0]).toBeDefined();

      useRunStore.getState().applyTestEnd('test-1', { status: 'passed' });
      expect(useRunStore.getState().workerMap[0]).toBeNull();
    });

    it('skips worker slot clear when test had no worker index', () => {
      useRunStore.getState().applyTestBegin({
        id: 'test-nowk',
        title: 'No worker',
        workerIndex: null,
      });
      const before = { ...useRunStore.getState().workerMap };
      useRunStore.getState().applyTestEnd('test-nowk', { status: 'passed' });
      expect(useRunStore.getState().workerMap).toEqual(before);
    });

    it('tracks multiple test status counters correctly', () => {
      useRunStore.getState().applyTestBegin({ id: 't1', title: 'A', workerIndex: 0 });
      useRunStore.getState().applyTestEnd('t1', { status: 'passed' });

      useRunStore.getState().applyTestBegin({ id: 't2', title: 'B', workerIndex: 1 });
      useRunStore.getState().applyTestEnd('t2', { status: 'failed' });

      useRunStore.getState().applyTestBegin({ id: 't3', title: 'C', workerIndex: 2 });
      useRunStore.getState().applyTestEnd('t3', { status: 'passed' });

      const run = useRunStore.getState().run;
      expect(run?.passed).toBe(2);
      expect(run?.failed).toBe(1);
    });
  });

  describe('appendTerminal', () => {
    it('appends terminal output', () => {
      useRunStore.getState().appendTerminal('line 1');
      useRunStore.getState().appendTerminal('line 2');
      expect(useRunStore.getState().terminalOutput).toEqual(['line 1', 'line 2']);
    });

    it('caps terminal output at 10K lines by trimming', () => {
      // Fill to over 10K
      const initial: string[] = [];
      for (let i = 0; i < 10_001; i++) {
        initial.push(`line-${i}`);
      }
      useRunStore.setState({ terminalOutput: initial });

      // Now append one more — should trigger the trim
      useRunStore.getState().appendTerminal('overflow-line');

      const output = useRunStore.getState().terminalOutput;
      // After trim: last 5000 of existing + new chunk = 5001
      expect(output.length).toBeLessThanOrEqual(5_001);
      expect(output[output.length - 1]).toBe('overflow-line');
    });
  });

  describe('clearTerminal', () => {
    it('clears terminal output', () => {
      useRunStore.getState().appendTerminal('line 1');
      useRunStore.getState().clearTerminal();
      expect(useRunStore.getState().terminalOutput).toEqual([]);
    });
  });

  describe('applyRunEnd', () => {
    it('merges run end data', () => {
      useRunStore.getState().applyRunStart({ id: 'run-1', total: 5 });
      useRunStore.getState().applyRunEnd({ status: 'passed', durationMs: 5000 });
      const run = useRunStore.getState().run;
      expect(run?.status).toBe('passed');
      expect(run?.durationMs).toBe(5000);
      expect(run?.id).toBe('run-1');
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      useRunStore.getState().setActiveRun('run-1');
      useRunStore.getState().applyRunStart({ id: 'run-1', total: 5 });
      useRunStore.getState().applyTestBegin({ id: 'test-1', title: 'A', workerIndex: 0 });
      useRunStore.getState().appendTerminal('chunk');

      useRunStore.getState().reset();
      const state = useRunStore.getState();
      expect(state.activeRunId).toBeNull();
      expect(state.run).toBeNull();
      expect(state.tests).toEqual({});
      expect(state.terminalOutput).toEqual([]);
      expect(state.workerMap).toEqual({});
    });
  });
});
