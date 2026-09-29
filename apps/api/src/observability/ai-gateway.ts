/**
 * Which model provider serves a request, decided once at startup.
 *
 * The chat route depends on the `AiGateway` **port**, not on a provider, so this is
 * the only file that knows Kilo and Ollama exist. That is the whole point of the
 * port: adding a provider is a change here and nowhere else, and a test can supply
 * a stub gateway without a network.
 *
 * `packages/automation` shipped this decision's *inputs* and never shipped the
 * decision — the port and both adapters existed, imported by nothing, which is
 * ledger X-4 at Critical. Deleting the package would have removed the only
 * interface the feature has for reaching a model, so the work was to wire it.
 *
 * **Absent configuration is not an error here.** The route answers 503 with a coded
 * body, which is a claim a client can act on; a startup failure would be a
 * deployment that will not start because an optional feature is unconfigured, and
 * an unconfigured feature is not a broken one.
 */
import { KiloGateway, OllamaGateway, type AiGateway } from '@automate/automation';

export type GatewayChoice = 'kilo' | 'ollama' | 'none';

export interface GatewayEnvironment {
  KILO_GATEWAY_URL?: string;
  KILO_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
}

/**
 * The gateway this environment is configured for, and why.
 *
 * A decision rather than a value, because the *absence* of a gateway is a state the
 * startup log has to be able to explain rather than a `null` somebody has to
 * interpret later.
 */
export type GatewayResolution =
  | { kind: 'kilo'; gateway: AiGateway }
  | { kind: 'ollama'; gateway: AiGateway }
  | { kind: 'none'; reason: string };

export function resolveAiGateway(env: GatewayEnvironment = process.env): GatewayResolution {
  const kiloUrl = env['KILO_GATEWAY_URL'];
  const kiloKey = env['KILO_API_KEY'];
  // Both, or neither. A URL without a key is an OpenAI-shaped endpoint that will
  // answer 401, and a key without a URL is a credential with nowhere to go —
  // either would be a configured-looking route that fails on first use.
  if (kiloUrl && kiloKey) {
    return { kind: 'kilo', gateway: new KiloGateway({ baseUrl: kiloUrl, apiKey: kiloKey }) };
  }
  if (kiloUrl || kiloKey) {
    return {
      kind: 'none',
      reason: 'KILO_GATEWAY_URL and KILO_API_KEY must both be set; only one was provided',
    };
  }
  const ollamaUrl = env['OLLAMA_BASE_URL'];
  if (ollamaUrl) return { kind: 'ollama', gateway: new OllamaGateway({ baseUrl: ollamaUrl }) };
  return { kind: 'none', reason: 'no model provider is configured' };
}

/**
 * The gateway for the API to use.
 *
 * Unconfigured is a gateway that refuses, not a missing one. The route maps a
 * refusal to `DEPENDENCY_UNAVAILABLE` — a coded 503 the client can act on — which
 * is a claim, where `undefined` would be a gap the route has to interpret and
 * might quietly treat as "no models configured".
 */
export function aiGatewayOrUnconfigured(resolution: GatewayResolution): AiGateway {
  if (resolution.kind !== 'none') return resolution.gateway;
  const reason = resolution.reason;
  return {
    listModels: () => Promise.reject(new Error(reason)),
    // An async generator rather than a function that throws: the route does
    // `for await (const chunk of streamCompletion(...))`, so the failure has to
    // arrive on the first `next()` for the route's `try` to see it. A function
    // that threw at call time would be outside that `try` and would escape the
    // request as an unhandled error instead of an `error` frame.
    streamCompletion: () => ({
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error(reason);
      },
    }),
  };
}
