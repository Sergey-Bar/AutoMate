import type {
  AiGateway,
  CompletionChunk,
  CompletionInput,
  ModelCatalogItem,
} from './ai-gateway.js';

export interface KiloGatewayOptions {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

type JsonRecord = Record<string, unknown>;

export class KiloGateway implements AiGateway {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: KiloGatewayOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async listModels(signal?: AbortSignal): Promise<ModelCatalogItem[]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher(`${this.options.baseUrl}/models`, {
          headers: { authorization: `Bearer ${this.options.apiKey}` },
          signal,
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: JsonRecord[] };
          return (body.data ?? [])
            .map((item) => ({
              id: String(item['id'] ?? ''),
              gateway: 'kilo',
              ownedBy: typeof item['owned_by'] === 'string' ? item['owned_by'] : undefined,
            }))
            .filter((item) => item.id.length > 0);
        }
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
          throw new Error(`Kilo catalog failed: ${response.status}`);
        }
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await this.sleep(100 * 2 ** attempt);
    }
    return [];
  }

  async *streamCompletion(input: CompletionInput): AsyncIterable<CompletionChunk> {
    const response = await this.fetcher(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        stream: true,
      }),
      signal: input.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`Kilo completion failed: ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: JsonRecord[] = [];
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const chunk = parseSseLine(line);
        if (chunk === undefined) continue;
        if (typeof chunk === 'string') {
          if (chunk === '[DONE]') return;
          continue;
        }
        const choices = (chunk['choices'] as JsonRecord[] | undefined) ?? [];
        const choice = choices[0];
        const delta = choice?.['delta'] as JsonRecord | undefined;
        const content = typeof delta?.['content'] === 'string' ? delta['content'] : '';
        if (content) yield { type: 'text', text: content };
        const calls = delta?.['tool_calls'];
        if (Array.isArray(calls)) toolCalls.push(...(calls as JsonRecord[]));
        const usage = chunk['usage'];
        if (usage && typeof usage === 'object') {
          yield {
            type: 'usage',
            usage: usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number },
          };
        }
        if (choice?.['finish_reason'] && toolCalls.length > 0) {
          yield { type: 'tool-call', call: toolCalls };
        }
        if (choice?.['finish_reason']) {
          yield { type: 'done', finishReason: String(choice['finish_reason']) };
        }
      }
      if (done) break;
    }
  }
}

function parseSseLine(line: string): JsonRecord | string | undefined {
  if (!line.startsWith('data:')) return undefined;
  const value = line.slice(5).trim();
  if (value === '[DONE]') return value;
  try {
    return JSON.parse(value) as JsonRecord;
  } catch {
    throw new Error('Invalid SSE JSON');
  }
}
