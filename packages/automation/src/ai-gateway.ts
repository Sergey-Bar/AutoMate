export interface ModelCatalogItem {
  id: string;
  gateway: string;
  ownedBy?: string;
}

export interface CompletionInput {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
  /**
   * Abandons the request.
   *
   * Present on the interface rather than left to each adapter, and the chat route
   * passes one. `streamCompletion` returns an `AsyncIterable` that the route
   * iterates long after the HTTP handler has returned, so the request deadline —
   * which disarms when the handler returns — never reaches the provider call.
   * Without this the only bound on a completion is however long the provider takes.
   */
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
