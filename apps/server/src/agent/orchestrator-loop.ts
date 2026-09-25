import { streamText, tool } from 'ai';
import type { ToolSet } from 'ai';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { ModelConfig } from './planner.js';
import { buildExecutionLogRow } from './logging.js';
import { createModelForProvider, isSupportedProvider } from './providers.js';
import type { MemoryRepository } from './memory.js';

export interface ToolExecuteEvent {
  toolName: string;
  input: unknown;
  output: unknown;
  status: 'success' | 'error';
  durationMs: number;
  errorMessage: string | null;
}

export interface StreamOptions {
  conversationId?: string;
  onToolExecute?: (event: ToolExecuteEvent) => void;
  onToolStart?: (toolName: string) => void;
  repo?: MemoryRepository;
}

/**
 * Resolves the fallback model from AUTOMATE_FALLBACK_PROVIDER env var.
 * Returns the fallback model config if the env var is set to a supported provider,
 * otherwise returns null (no fallback).
 */
export function getFallbackModelConfig(primaryConfig: ModelConfig): ModelConfig | null {
  const fallbackProvider = process.env.AUTOMATE_FALLBACK_PROVIDER;
  if (!fallbackProvider || !isSupportedProvider(fallbackProvider)) return null;
  if (fallbackProvider === primaryConfig.provider) return null;

  const fallbackModel = process.env.AUTOMATE_FALLBACK_MODEL ?? primaryConfig.model;
  const fallbackEndpoint = process.env.AUTOMATE_FALLBACK_ENDPOINT ?? primaryConfig.endpoint;

  return {
    provider: fallbackProvider,
    model: fallbackModel,
    endpoint: fallbackEndpoint,
    temperature: primaryConfig.temperature,
    maxTokens: primaryConfig.maxTokens,
  };
}

export function createOrchestrator(registry: ConnectorRegistry) {
  return {
    buildStreamParams(
      messages: Array<{ role: string; content: string }>,
      systemPrompt: string,
      modelConfig: ModelConfig,
      credentials: Record<string, Record<string, string>>,
    ) {
      const manifests = registry.listManifests();

      // Convert connector tools to AI SDK tools
      const tools: ToolSet = {};
      for (const manifest of manifests) {
        const connectorCreds = credentials[manifest.name] ?? {};
        for (const t of manifest.tools) {
          const toolKey = `${manifest.name}__${t.name}`;
          const wrappedTool = tool({
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async (input: unknown) => {
              const result = await registry.dispatch(`${manifest.name}.${t.name}`, input, connectorCreds);
              return result.content.map((c: { text: string }) => c.text).join('\n');
            },
          });
          tools[toolKey] = wrappedTool as unknown as ToolSet[string];
        }
      }

      return {
        model: createModelForProvider(modelConfig) as Parameters<typeof streamText>[0]['model'],
        system: systemPrompt,
        messages: messages as Parameters<typeof streamText>[0]['messages'] & {},
        tools,
        maxSteps: 5,
        temperature: modelConfig.temperature ?? 0.7,
        maxTokens: modelConfig.maxTokens ?? 4096,
      };
    },

    stream(
      messages: Array<{ role: string; content: string }>,
      systemPrompt: string,
      modelConfig: ModelConfig,
      credentials: Record<string, Record<string, string>>,
      options?: StreamOptions,
    ): ReturnType<typeof streamText> {
      const params = this.buildStreamParams(messages, systemPrompt, modelConfig, credentials);

      // Resolve fallback config (may be null if not configured)
      const fallbackConfig = getFallbackModelConfig(modelConfig);

      // If logging is enabled, wrap tool executions
      if (options?.onToolExecute || options?.onToolStart || options?.repo) {
        const wrappedTools: ToolSet = {};
        for (const [key, t] of Object.entries(params.tools)) {
          const originalTool = t as { execute?: (input: unknown) => Promise<unknown>; description?: string; parameters?: unknown };
          wrappedTools[key] = {
            ...originalTool,
            execute: originalTool.execute ? async (input: unknown) => {
              options.onToolStart?.(key);
              const start = Date.now();
              try {
                const result = await originalTool.execute!(input);
                const durationMs = Date.now() - start;
                const logRow = buildExecutionLogRow(
                  options.conversationId ?? '',
                  key,
                  input,
                  result,
                  'success',
                  durationMs,
                  null,
                );
                options.onToolExecute?.({ toolName: key, input, output: result, status: 'success', durationMs, errorMessage: null });
                await options.repo?.insertExecutionLog(logRow);

                // When the AI triggers a test run, store the runId in the conversation
                // so subsequent turns can reference it for status checks.
                if (key === 'dashboard__triggerTestRun' && options.repo && options.conversationId) {
                  const runIdMatch = (result as string).match(/Run ID:\s*([^,\s\n]+)/);
                  if (runIdMatch) {
                    const runId = runIdMatch[1];
                    await options.repo.saveMessage({
                      id: crypto.randomUUID(),
                      conversationId: options.conversationId,
                      role: 'system',
                      content: `[System: Test run triggered. Run ID: ${runId}. Use dashboard__getRunStatus to check progress.]`,
                    });
                  }
                }

                return result;
              } catch (err) {
                const durationMs = Date.now() - start;
                const errorMessage = err instanceof Error ? err.message : String(err);
                options.onToolExecute?.({ toolName: key, input, output: null, status: 'error', durationMs, errorMessage });
                throw err;
              }
            } : undefined,
          } as unknown as ToolSet[string];
        }

        if (fallbackConfig) {
          return streamWithFallback({ ...params, tools: wrappedTools }, fallbackConfig);
        }
        return streamText({ ...params, tools: wrappedTools });
      }

      if (fallbackConfig) {
        return streamWithFallback(params, fallbackConfig);
      }
      return streamText(params);
    },
  };
}

/**
 * Attempts to stream with the primary model params. If a connection or auth
 * error is encountered, logs a warning and retries with the fallback provider.
 *
 * Note: StreamTextResult (AI SDK v6) is not a Promise/Thenable. Error
 * interception is done via the async `.text` property which is a PromiseLike.
 * The fallback is best-effort -- if the consumer already started consuming the
 * primary stream they may not benefit from the fallback.
 */
function streamWithFallback(
  params: Parameters<typeof streamText>[0],
  fallbackConfig: ModelConfig,
): ReturnType<typeof streamText> {
  const primaryResult = streamText(params);
  const fallbackModel = createModelForProvider(fallbackConfig) as Parameters<typeof streamText>[0]['model'];

  // Attach a silent error watcher to the primary stream's .text PromiseLike.
  // If it rejects with a retryable error, kick off the fallback stream.
  void primaryResult.text.then(undefined, (primaryError: unknown) => {
    const errorMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
    const isRetryable =
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('Connection refused') ||
      errorMessage.includes('API key');

    if (!isRetryable) return;

    console.warn(
      `[Automate] Primary provider failed (${errorMessage}). Falling back to ${fallbackConfig.provider}/${fallbackConfig.model}.`,
    );

    const fallbackParams = { ...params, model: fallbackModel };
    void streamText(fallbackParams).text.then(undefined, (_fallbackError: unknown) => {
      // Both failed -- silently swallow fallback error
    });
  });

  return primaryResult;
}
