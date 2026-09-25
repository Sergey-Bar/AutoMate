import { useQuery } from '@tanstack/react-query';
import { RunSchema, TestSchema, ResultSchema, CompareRowSchema } from '@/lib/types';
import { z } from 'zod';
import type { CompareRow } from '@/lib/types';
import { useWorkspaceStore } from '@/store/workspaceStore';

const API = '/api';

// ─── Runs ──────────────────────────────────────────────────────────────────
export function useRuns() {
  const wsId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery({
    queryKey: ['runs', wsId],
    queryFn: async () => {
      const url = wsId ? `${API}/runs?workspaceId=${wsId}` : `${API}/runs`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch runs');
      const data = await res.json();
      return z.array(RunSchema).parse(data);
    },
    refetchInterval: 10_000,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: async () => {
      const res = await fetch(`${API}/runs/${runId}`);
      if (!res.ok) throw new Error('Run not found');
      const data = await res.json();
      return RunSchema.parse(data);
    },
    enabled: !!runId,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────
export function useRunTests(runId: string) {
  return useQuery({
    queryKey: ['run-tests', runId],
    queryFn: async () => {
      const res = await fetch(`${API}/runs/${runId}/tests`);
      if (!res.ok) throw new Error('Failed to fetch tests');
      const data = await res.json();
      return z.array(TestSchema).parse(data);
    },
    enabled: !!runId,
  });
}

export function useTest(runId: string, testId: string) {
  return useQuery({
    queryKey: ['test', runId, testId],
    queryFn: async () => {
      const res = await fetch(`${API}/runs/${runId}/tests/${testId}`);
      if (!res.ok) throw new Error('Test not found');
      const data = await res.json();
      return {
        ...TestSchema.parse(data),
        results: z.array(ResultSchema).parse(data.results ?? []),
      };
    },
    enabled: !!runId && !!testId,
  });
}

// ─── Mutation: start run ────────────────────────────────────────────────────
export async function startRun(options: object): Promise<{ runId: string }> {
  const res = await fetch(`${API}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error('Failed to start run');
  return res.json();
}

// ─── Fingerprints ─────────────────────────────────────────────────────────
export interface FingerprintGroup {
  fingerprint: string;
  count: number;
  errorMessage: string;
  testIds: string[];
}

export function useRunFingerprints(runId: string) {
  return useQuery<FingerprintGroup[]>({
    queryKey: ['run-fingerprints', runId],
    queryFn: async () => {
      const res = await fetch(`${API}/runs/${runId}/fingerprints`);
      if (!res.ok) throw new Error('Failed to fetch fingerprints');
      return res.json() as Promise<FingerprintGroup[]>;
    },
    enabled: !!runId,
    staleTime: 30_000,
  });
}

// ─── Mutation: abort run ──────────────────────────────────────────────
export async function abortRun(runId: string): Promise<void> {
  await fetch(`${API}/runs/${runId}`, { method: 'DELETE' });
}

// ─── Compare runs ──────────────────────────────────────────────────────
export function useRunCompare(runIdA: string | null, runIdB: string | null) {
  return useQuery<CompareRow[]>({
    queryKey: ['run-compare', runIdA, runIdB],
    queryFn: async () => {
      const res = await fetch(`${API}/runs/compare?a=${runIdA}&b=${runIdB}`);
      if (!res.ok) throw new Error('Failed to fetch comparison');
      const data = await res.json();
      return z.array(CompareRowSchema).parse(data);
    },
    enabled: !!runIdA && !!runIdB,
    staleTime: 60_000,
  });
}
