/**
 * chat.routes.ts — the API's only consumer of `packages/automation`.
 *
 * That package declares a two-method port, `listModels` and `streamCompletion`,
 * and two adapters, and until this route existed nothing imported any of it. The
 * port was built and never wired, which is ledger X-4 at Critical: deleting the
 * package would have removed the only interface the feature has for reaching a
 * model, so the fix was to wire it rather than to delete it.
 *
 * **The route depends on the port, not on a provider.** Which gateway serves a
 * request is decided at the composition root from configuration, so this file
 * knows nothing about Kilo, Ollama, or a model catalogue — and a test supplies a
 * stub and never reaches a network. Adding a provider is a change to the root.
 *
 * **A stream that stops early says so.** The chunks are streamed as server-sent
 * events, and the one thing the wire format cannot express is "this stopped
 * because it finished" against "this stopped because it broke" — they are the
 * same bytes. A chat client that reads a partial answer as a complete one would
 * render a half-read failure report as if it were the whole, which for this
 * product is the specific failure the evidence rules exist to prevent. So the
 * stream ends with a `done` frame on success and an `error` frame on failure,
 * and the partial text is delivered either way: throwing it away discards work the
 * reader already paid for.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import type { AiGateway, CompletionChunk } from '@automate/automation';

export interface ChatRoutesOptions {
  /** The configured gateway. Which one is the composition root's decision. */
  gateway: AiGateway;
}

/** The largest chat request accepted, in bytes. */
export const MAX_CHAT_BODY_BYTES = 256 * 1024;

/** How long one completion may run before the provider call is abandoned. */
export const CHAT_TIMEOUT_MS = 120_000;

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  // Bounded per message as well as overall: an array of a million one-byte messages
  // passes any count limit and still costs a provider a fortune, so the size of each
  // one matters as much as the size of the request.
  content: z.string().max(32_000),
});

const CompletionRequestSchema = z.object({
  model: z.string().min(1, 'model is required').max(200),
  messages: z.array(MessageSchema).min(1, 'messages must not be empty').max(200),
  // Optional, and it was briefly not: making it required refused every request
  // that did not send tools, which is most of them. The count limit is only
  // meaningful on the field that exists.
  tools: z.array(z.unknown()).max(64).optional(),
});

export function createChatRoutes(options: ChatRoutesOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/chat/models ───────────────────────────────────────────
  app.get('/api/v1/chat/models', async (c) => {
    try {
      const models = await options.gateway.listModels();
      return c.json({ models });
    } catch (cause) {
      // Not an empty list. "There is no model" and "I could not ask" are opposite
      // claims and only the second is true here, so the client is told which it
      // got rather than handed a plausible-looking answer.
      //
      // `DEPENDENCY_UNAVAILABLE` rather than a new code: the taxonomy already has
      // a 503 for "a dependency is unavailable", and a second code for the same
      // condition is a second thing for a client to handle. The first version
      // passed `502` as a status alongside a new code, and the boundary ignores a
      // status that is not in the table — so it returned 500 and the test caught
      // a claim the route was not making.
      throw new DomainError(
        'DEPENDENCY_UNAVAILABLE',
        'The configured model provider could not be reached',
        { details: { reason: cause instanceof Error ? cause.message : 'unknown' } },
      );
    }
  });

  // ── POST /api/v1/chat/completions ──────────────────────────────────────
  app.post('/api/v1/chat/completions', async (c) => {
    // Bounded before parsing, like the execution routes. `await c.req.json()`
    // buffers the whole body, so an unbounded one is an unbounded allocation on a
    // public endpoint.
    const declared = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_CHAT_BODY_BYTES) {
      throw new DomainError('VALIDATION_FAILED', 'Request body is too large');
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'Request body is not valid JSON');
    }
    const parsed = CompletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Refused before the gateway is touched, so a malformed request costs no
      // tokens and the error names the field rather than streaming an empty answer.
      throw new DomainError(
        'VALIDATION_FAILED',
        parsed.error.issues[0]?.message ?? 'Request is invalid',
      );
    }
    const { model, messages, tools } = parsed.data;
    // One controller per request, so an abandoned or timed-out response releases
    // the provider call rather than leaving it streaming into nothing.
    const controller = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => controller.abort(), { once: true });

    return streamSSE(c, async (stream) => {
      // The request deadline disarms in its own `finally` as soon as `await next()`
      // returns, and a `streamSSE` handler returns its `Response` before the body is
      // consumed — so the 30s budget does not reach the provider call. That is the
      // failure the deadline middleware exists to prevent, so the signal is derived
      // here and the route is exempted from the middleware in `index.ts` so the
      // intent is recorded rather than accidental.
      const timeout = setTimeout(
        () => controller.abort(new Error('chat deadline exceeded')),
        CHAT_TIMEOUT_MS,
      );
      try {
        for await (const chunk of options.gateway.streamCompletion({
          model,
          messages,
          tools,
          signal: controller.signal,
        })) {
          await writeChunk(stream, chunk);
        }
        // The frame that says "this finished". Its absence is what makes a broken
        // stream indistinguishable from a short one.
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ finishReason: 'stop' }) });
      } catch (cause) {
        // The partial text is already on the wire and stays there. Dropping it
        // would discard what the reader already paid for, and the `error` frame
        // below says why the answer stops.
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: 'CHAT_PROVIDER_FAILED',
            message: cause instanceof Error ? cause.message : 'The provider stream failed',
          }),
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  return app;
}

/**
 * One chunk, in the frame shape a client reads.
 *
 * Every variant is serialised whole rather than flattened, so a client
 * discriminates on `type` and a chunk type added later is an unknown the client
 * can ignore rather than one it misreads.
 */
async function writeChunk(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  chunk: CompletionChunk,
): Promise<void> {
  await stream.writeSSE({
    event: chunk.type,
    data: JSON.stringify(chunk.type === 'text' ? { text: chunk.text } : chunk),
  });
}
