import type {
  AiGateway,
  CompletionChunk,
  CompletionInput,
  ModelCatalogItem,
} from './ai-gateway.js';
import { parseJsonLine, readLines, withTimeout } from './lines.js';

type JsonRecord = Record<string, unknown>;

export interface OllamaGatewayOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  /** How long a single request may take before it is abandoned. See `KiloGatewayOptions`. */
  requestTimeoutMs?: number;
}

/** The default request deadline. Matches the Kilo adapter's. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class OllamaGateway implements AiGateway {
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: OllamaGatewayOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * The model catalog.
   *
   * The `signal` parameter was missing entirely, not merely unwired — this method
   * took no signal at all against an interface that declares one, so TypeScript
   * could not flag the omission and a cancelled catalog request simply kept running
   * (ledger G-6). The row described it as a dropped signal; the honest statement is
   * that it was an absent one.
   */
  async listModels(signal?: AbortSignal): Promise<ModelCatalogItem[]> {
    const response = await this.fetcher(`${this.options.baseUrl}/api/tags`, {
      signal: withTimeout(signal, this.requestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama catalog failed: ${response.status}`);
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).flatMap((model) =>
      model.name ? [{ id: model.name, gateway: 'ollama' }] : [],
    );
  }

  async *streamCompletion(input: CompletionInput): AsyncIterable<CompletionChunk> {
    const response = await this.fetcher(`${this.options.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        // The caller's tool list, forwarded. This was never referenced in this file,
        // so a tool-using request silently degraded to a plain completion: the caller
        // asked for a tool, got prose, and had nothing to say so (ledger G-5). The
        // Kilo adapter has always forwarded it, which is what made the omission here
        // invisible rather than a deliberate difference between the two.
        tools: input.tools,
        stream: true,
      }),
      signal: withTimeout(input.signal, this.requestTimeoutMs),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Ollama completion failed: ${response.status}`);
    }

    // Ollama streams NDJSON — one JSON object per line — rather than SSE. The line
    // framing is shared with the Kilo adapter (ledger G-1, G-2) but the parsing is
    // not, so it stays here.
    for await (const line of readLines(response.body)) {
      // A line that is not JSON is skipped rather than thrown on. Ollama's
      // `/api/chat` emits bare tokens on some builds, and one of those used to
      // abort a completion that had already delivered text (ledger G-7).
      const payload = parseJsonLine(line);
      if (payload === undefined) continue;

      const message = payload['message'] as JsonRecord | undefined;
      const content = typeof message?.['content'] === 'string' ? message['content'] : '';
      if (content) yield { type: 'text', text: content };

      const toolCalls = message?.['tool_calls'];
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        yield { type: 'tool-call', call: toolCalls };
      }

      const inputTokens = numeric(payload['prompt_eval_count']);
      const outputTokens = numeric(payload['eval_count']);
      if (inputTokens !== undefined || outputTokens !== undefined) {
        yield {
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens,
            totalTokens:
              inputTokens === undefined && outputTokens === undefined
                ? undefined
                : (inputTokens ?? 0) + (outputTokens ?? 0),
          },
        };
      }

      if (payload['done'] === true) {
        yield {
          type: 'done',
          finishReason:
            typeof payload['done_reason'] === 'string' ? payload['done_reason'] : 'stop',
        };
      }
    }
  }
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
