import type { CanonicalRunResult } from '@automate/shared-contracts';

export interface ProducerContext {
  workspaceId: string;
  runId: string;
  projectId?: string;
  sourceUri: string;
  sourceDigest: string;
  producerVersion: string;
  adapterVersion: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ProducerAdapter {
  readonly mediaType: string;
  parse(input: Uint8Array, context: ProducerContext): CanonicalRunResult;
}
