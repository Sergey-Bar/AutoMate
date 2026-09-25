export interface ModelCatalogItem {
  id: string;
  gateway: string;
  ownedBy?: string;
}

export interface CompletionInput {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
  signal?: AbortSignal;
  tools?: unknown[];
}

export type CompletionChunk =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; call: unknown }
  | { type: 'usage'; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }
  | { type: 'done'; finishReason: string };

export interface AiGateway {
  listModels(signal?: AbortSignal): Promise<ModelCatalogItem[]>;
  streamCompletion(input: CompletionInput): AsyncIterable<CompletionChunk>;
}
