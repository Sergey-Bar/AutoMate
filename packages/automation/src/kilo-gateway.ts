import type {
  AiGateway,
  CompletionChunk,
  CompletionInput,
  ModelCatalogItem,
} from './ai-gateway.js';
import { parseJsonLine, readLines, withTimeout } from './lines.js';

export interface KiloGatewayOptions {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  /**
   * How long a single request may take before it is abandoned.
   *
   * A gateway request used to be bounded only by whatever signal the caller
   * happened to pass, so a provider that accepted the connection and then stopped
   * responding held the request open forever (ledger G-8). Overridable so a test
   * can assert the deadline without waiting for it.
   */
  requestTimeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

/** Attempts for a catalog request, including the first. */
const CATALOG_ATTEMPTS = 3;
/** The default request deadline. Long enough for a cold model, short enough to notice. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/**
 * Statuses worth another attempt. Everything else is a statement about the request
 * and will fail identically on the third try as on the first.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * A tool call as the provider streams it: fragments arrive split across chunks,
 * keyed by `index`, and only form a whole call once assembled.
 */
interface ToolCallAccumulator {
  readonly order: number[];
  readonly byIndex: Map<number, JsonRecord>;
}

function newAccumulator(): ToolCallAccumulator {
  return { order: [], byIndex: new Map() };
}

/**
 * Merge two fragments of the same call.
 *
 * **Strings concatenate; everything else is replaced.** That asymmetry is the whole
 * point. A streaming provider splits `function.arguments` across chunks — the second
 * fragment is the *tail* of the first, not a new value — so a plain object spread
 * silently discards every fragment but the last, and a tool call arrives with half a
 * JSON payload and no error anywhere. Concatenating strings is also right for `id`
 * and `name`, which some providers split the same way.
 *
 * @param existing the fragments merged so far
 * @param incoming the newest fragment
 * @returns the merged call, with the transport `index` removed
 */
function mergeFragments(existing: JsonRecord, incoming: JsonRecord): JsonRecord {
  const merged: JsonRecord = {};
  for (const key of new Set([...Object.keys(existing), ...Object.keys(incoming)])) {
    if (key === 'index') continue;
    const before = existing[key];
    const after = incoming[key];
    if (typeof before === 'string' && typeof after === 'string') {
      merged[key] = before + after;
      continue;
    }
    if (
      typeof before === 'object' &&
      before !== null &&
      typeof after === 'object' &&
      after !== null
    ) {
      // `function` is the nested object a split call actually lives in.
      merged[key] = mergeFragments(before as JsonRecord, after as JsonRecord);
      continue;
    }
    if (after !== undefined) merged[key] = after;
  }
  return merged;
}

/**
 * Add this chunk's fragments to the accumulator, keyed by `index`.
 *
 * A streaming provider sends a tool call as a sequence of partial objects, each
 * carrying the same `index` and a different slice of the call. Flat-appending them
 * produced N partial objects presented as N tool calls, so a caller invoking tools
 * would call the same broken one several times (ledger G-3).
 */
function accumulateToolCalls(
  accumulator: ToolCallAccumulator,
  fragments: readonly JsonRecord[],
): void {
  for (const fragment of fragments) {
    const rawIndex = fragment['index'];
    const index = typeof rawIndex === 'number' ? rawIndex : accumulator.order.length;
    const existing = accumulator.byIndex.get(index);
    if (existing === undefined) {
      accumulator.order.push(index);
      accumulator.byIndex.set(index, mergeFragments({}, fragment));
      continue;
    }
    accumulator.byIndex.set(index, mergeFragments(existing, fragment));
  }
}

function assembledCalls(accumulator: ToolCallAccumulator): JsonRecord[] {
  return accumulator.order.map((index) => accumulator.byIndex.get(index)).filter(isPresent);
}

function isPresent(value: JsonRecord | undefined): value is JsonRecord {
  return value !== undefined;
}

/**
 * Map the provider's OpenAI-shaped usage block onto the read model.
 *
 * This was a cast, which is a rename and not a mapping: the provider sends
 * `input_tokens`/`output_tokens` and the consumer read `inputTokens`/`outputTokens`,
 * so every field arrived `undefined` and the caller recorded no token cost at all
 * (ledger G-4). `totalTokens` is computed when the provider omits it, because a
 * total the caller has to add up is a total nobody adds up.
 */
function mapUsage(usage: JsonRecord): CompletionChunk {
  const read = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
  };
  const inputTokens = read('input_tokens', 'prompt_tokens');
  const outputTokens = read('output_tokens', 'completion_tokens');
  const totalTokens = read('total_tokens') ?? sumDefined(inputTokens, outputTokens);
  return { type: 'usage', usage: { inputTokens, outputTokens, totalTokens } };
}

function sumDefined(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : present.reduce((left, right) => left + right, 0);
}

export class KiloGateway implements AiGateway {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: KiloGatewayOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async listModels(signal?: AbortSignal): Promise<ModelCatalogItem[]> {
    let failure: unknown;
    for (let attempt = 0; attempt < CATALOG_ATTEMPTS; attempt += 1) {
      let retryable = true;
      try {
        const response = await this.fetcher(`${this.options.baseUrl}/models`, {
          headers: { authorization: `Bearer ${this.options.apiKey}` },
          signal: withTimeout(signal, this.requestTimeoutMs),
        });
        if (response.ok) return this.readCatalog(response);
        if (!RETRYABLE_STATUS.has(response.status)) {
          // A status that will not change. Recorded and broken out of the loop
          // rather than thrown from inside the `try`, because the `catch` below
          // cannot tell a fatal status from a transport error — which is how a 401
          // or 400 came to be issued three times (ledger P-24).
          failure = new Error(`Kilo catalog failed: ${response.status}`);
          retryable = false;
        }
      } catch (error) {
        // A genuine transport error, which *is* worth another attempt.
        failure = error;
      }
      if (!retryable || attempt === CATALOG_ATTEMPTS - 1) break;
      await this.sleep(100 * 2 ** attempt);
    }
    throw failure ?? new Error('Kilo catalog unavailable');
  }

  private async readCatalog(response: Response): Promise<ModelCatalogItem[]> {
    const body = (await response.json()) as { data?: JsonRecord[] };
    return (body.data ?? [])
      .map((item) => ({
        id: String(item['id'] ?? ''),
        gateway: 'kilo',
        ownedBy: typeof item['owned_by'] === 'string' ? item['owned_by'] : undefined,
      }))
      .filter((item) => item.id.length > 0);
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
      signal: withTimeout(input.signal, this.requestTimeoutMs),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Kilo completion failed: ${response.status}`);
    }

    const toolCalls = newAccumulator();
    for await (const line of readLines(response.body)) {
      const frame = this.parseFrame(line);
      if (frame === undefined) continue;
      if (frame === DONE) return;
      const choices = (frame['choices'] as JsonRecord[] | undefined) ?? [];
      const choice = choices[0];
      const delta = choice?.['delta'] as JsonRecord | undefined;
      const content = typeof delta?.['content'] === 'string' ? delta['content'] : '';
      if (content) yield { type: 'text', text: content };

      const calls = delta?.['tool_calls'];
      if (Array.isArray(calls)) {
        accumulateToolCalls(toolCalls, calls as JsonRecord[]);
      }

      const usage = frame['usage'];
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        yield mapUsage(usage as JsonRecord);
      }

      if (choice?.['finish_reason']) {
        // Emitted once, at the end, from the assembled calls — and the accumulator is
        // then cleared, so a stream carrying more than one `finish_reason` cannot
        // re-emit the same tool call (ledger G-3).
        if (toolCalls.order.length > 0) {
          yield { type: 'tool-call', call: assembledCalls(toolCalls) };
          toolCalls.order.length = 0;
          toolCalls.byIndex.clear();
        }
        yield { type: 'done', finishReason: String(choice['finish_reason']) };
      }
    }
  }

  /**
   * One SSE line as a frame, or `undefined` for a line that is not one.
   *
   * A line that is not a `data:` frame — a keep-alive comment, a blank separator —
   * or whose payload is not JSON is skipped, not thrown on. A single unusable line
   * used to abort a stream that had already delivered events, discarding the rest
   * of a completion (ledger G-7).
   */
  private parseFrame(line: string): JsonRecord | typeof DONE | undefined {
    if (!line.startsWith('data:')) return undefined;
    const value = line.slice(5).trim();
    if (value === '[DONE]') return DONE;
    return parseJsonLine(value);
  }
}

const DONE = '[DONE]';
