/**
 * useLiveRun.ts
 *
 * Opens a WebSocket connection for a specific run and pipes events into
 * the global runStore. Safe to call in multiple components — deduplicates
 * via the wsStore connection management.
 */
import { useEffect } from 'react';
import { useWsStore } from '@/store/wsStore';
import { useRunStore } from '@/store/runStore';
import type { WsEvent } from '@/lib/types';

export function useLiveRun(runId: string) {
  const connect = useWsStore((s) => s.connect);
  const subscribe = useWsStore((s) => s.subscribe);
  const connectionState = useWsStore((s) => s.connectionState);

  const applyRunStart = useRunStore((s) => s.applyRunStart);
  const applyTestBegin = useRunStore((s) => s.applyTestBegin);
  const applyTestEnd = useRunStore((s) => s.applyTestEnd);
  const appendTerminal = useRunStore((s) => s.appendTerminal);
  const applyRunEnd = useRunStore((s) => s.applyRunEnd);
  const setActiveRun = useRunStore((s) => s.setActiveRun);

  useEffect(() => {
    if (!runId) return;
    setActiveRun(runId);
    connect(runId);

    const unsubs = [
      subscribe('run:start', (e: WsEvent) => {
        if (e.runId !== runId) return;
        applyRunStart(e.payload as never);
      }),
      subscribe('test:begin', (e: WsEvent) => {
        if (e.runId !== runId) return;
        applyTestBegin(e.payload as never);
      }),
      subscribe('test:end', (e: WsEvent) => {
        if (e.runId !== runId) return;
        const p = e.payload as { testId: string; [k: string]: unknown };
        applyTestEnd(p.testId, p as never);
      }),
      subscribe('stdout', (e: WsEvent) => {
        if (e.runId !== runId) return;
        appendTerminal((e.payload as { chunk: string }).chunk);
      }),
      subscribe('stderr', (e: WsEvent) => {
        if (e.runId !== runId) return;
        appendTerminal((e.payload as { chunk: string }).chunk);
      }),
      subscribe('run:end', (e: WsEvent) => {
        if (e.runId !== runId) return;
        applyRunEnd(e.payload as never);
      }),
    ];

    return () => {
      unsubs.forEach((u) => {
        u();
      });
      useWsStore.getState().disconnect();
    };
  }, [runId, appendTerminal, applyRunEnd, applyRunStart, applyTestBegin, applyTestEnd, connect, setActiveRun, subscribe]);

  return { connectionState };
}
