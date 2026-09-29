import { describe, expect, it } from 'vitest';
import { aiGatewayOrUnconfigured, resolveAiGateway } from './ai-gateway.js';

/**
 * The provider decision, which is the one place that knows Kilo and Ollama exist.
 *
 * `packages/automation` shipped the port and both adapters and imported neither,
 * which is ledger X-4. Wiring it means the decision has to live somewhere concrete
 * and be testable without a network — this file, called from the composition root.
 *
 * The interesting cases are the ones where configuration is *partially* present. A
 * URL with no key and a key with no URL both produce a gateway that looks configured
 * and fails on first use, and both are more expensive than a refusal at startup.
 */
describe('resolveAiGateway', () => {
  it('selects Kilo when its URL and key are both set', () => {
    const resolution = resolveAiGateway({
      KILO_GATEWAY_URL: 'https://gateway.example',
      KILO_API_KEY: 'key',
    });
    expect(resolution.kind).toBe('kilo');
  });

  it('selects Ollama when only its base URL is set', () => {
    // No key: Ollama is local, so a key is not part of its configuration and
    // requiring one would make the local provider unusable.
    expect(resolveAiGateway({ OLLAMA_BASE_URL: 'http://127.0.0.1:11434' }).kind).toBe('ollama');
  });

  it('prefers Kilo over Ollama when both are configured', () => {
    // Stated rather than incidental: the order is a product decision, and a
    // reordering that silently switched providers would otherwise look identical.
    expect(
      resolveAiGateway({
        KILO_GATEWAY_URL: 'https://gateway.example',
        KILO_API_KEY: 'key',
        OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      }).kind,
    ).toBe('kilo');
  });

  it('refuses a Kilo URL with no key, rather than building a gateway that will 401', () => {
    const resolution = resolveAiGateway({ KILO_GATEWAY_URL: 'https://gateway.example' });
    expect(resolution.kind).toBe('none');
    if (resolution.kind === 'none') {
      expect(resolution.reason).toMatch(/KILO_API_KEY/);
    }
  });

  it('refuses a Kilo key with no URL', () => {
    const resolution = resolveAiGateway({ KILO_API_KEY: 'key' });
    expect(resolution.kind).toBe('none');
  });

  it('reports no provider when nothing is configured at all', () => {
    // An unconfigured optional feature, not a startup failure: the route answers a
    // coded 503, which a client can act on, where refusing to boot would be a
    // deployment that cannot start because chat is switched off.
    const resolution = resolveAiGateway({});
    expect(resolution.kind).toBe('none');
    if (resolution.kind === 'none') expect(resolution.reason).toMatch(/no model provider/i);
  });
});

describe('aiGatewayOrUnconfigured', () => {
  it('refuses the catalogue with the reason, rather than answering an empty list', async () => {
    // An empty list says "there is no model"; a refusal says "I could not ask".
    // They are opposite claims, and only the second is true of an unconfigured
    // installation.
    const gateway = aiGatewayOrUnconfigured({ kind: 'none', reason: 'no model provider' });
    await expect(gateway.listModels()).rejects.toThrow('no model provider');
  });

  it('refuses a completion on the first pull, so the route can report it', async () => {
    // The route does `for await (const chunk of streamCompletion(...))` inside a
    // `try`. A `streamCompletion` that threw when *called* would be outside that
    // `try` and would escape as an unhandled error; the failure has to arrive on
    // the first `next()` to become an `error` frame.
    const gateway = aiGatewayOrUnconfigured({ kind: 'none', reason: 'no model provider' });
    const iterate = async (): Promise<void> => {
      for await (const _chunk of gateway.streamCompletion({ model: 'm', messages: [] })) {
        // Nothing should arrive.
      }
    };
    await expect(iterate()).rejects.toThrow('no model provider');
  });

  it('passes a configured gateway through untouched', () => {
    const configured = { listModels: () => Promise.resolve([]) } as never;
    // Identity, not equality: a second wrapper would be a second thing whose
    // behaviour could differ from the gateway it stands for.
    const resolution = { kind: 'ollama', gateway: configured } as const;
    expect(aiGatewayOrUnconfigured(resolution)).toBe(configured);
  });
});
