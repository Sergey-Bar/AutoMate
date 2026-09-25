import type {
  AiGateway,
  CompletionChunk,
  CompletionInput,
  ModelCatalogItem,
} from './ai-gateway.js';

type JsonRecord = Record<string, unknown>;

export interface OllamaGatewayOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
}

export class OllamaGateway implements AiGateway {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: OllamaGatewayOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async listModels(): Promise<ModelCatalogItem[]> {
    const response = await this.fetcher(`${this.options.baseUrl}/api/tags`);
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
      body: JSON.stringify({ model: input.model, messages: input.messages, stream: true }),
      signal: input.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`Ollama completion failed: ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        const payload = JSON.parse(line) as JsonRecord;
        const message = payload['message'] as JsonRecord | undefined;
        const content = typeof message?.['content'] === 'string' ? message['content'] : '';
        if (content) yield { type: 'text', text: content };
        const toolCalls = message?.['tool_calls'];
        if (Array.isArray(toolCalls)) yield { type: 'tool-call', call: toolCalls };
        if (
          typeof payload['prompt_eval_count'] === 'number' ||
          typeof payload['eval_count'] === 'number'
        ) {
          yield {
            type: 'usage',
            usage: {
              inputTokens:
                typeof payload['prompt_eval_count'] === 'number'
                  ? payload['prompt_eval_count']
                  : undefined,
              outputTokens:
                typeof payload['eval_count'] === 'number' ? payload['eval_count'] : undefined,
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
      if (done) break;
    }
  }
}
