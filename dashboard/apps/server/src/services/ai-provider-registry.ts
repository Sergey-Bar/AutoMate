/**
 * apps/server/src/services/ai-provider-registry.ts — AI provider registry
 *
 * Tier 1:  ollama, openai, anthropic (native adapters)
 * Tier 2:  google, azure-openai, groq, mistral, openrouter, cohere
 *          (OpenAI-compatible API with custom baseURL)
 * Tier 3:  bedrock (feature-flagged — not yet implemented, returns NotConfigured)
 */

import type { AiProviderConfig } from '@automate/dashboard-shared';

// ── Adapter interface ─────────────────────────────────────────────────────────

export interface AiProviderAdapter {
  readonly name: string;
  createCompletion(prompt: string, config: AiProviderConfig): Promise<string>;
  validate(config: AiProviderConfig): boolean;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a test automation expert. Analyze test failures and provide concise explanations and actionable suggestions.';

const TIMEOUT_MS = 30_000;

// ── Shared OpenAI-compatible fetch helper ─────────────────────────────────────

async function fetchOpenAiCompat(
  endpoint: string,
  model: string,
  apiKey: string,
  prompt: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? 'No response from AI';
  } finally {
    clearTimeout(timeout);
  }
}

// ── Tier 1 — Ollama ───────────────────────────────────────────────────────────

class OllamaAdapter implements AiProviderAdapter {
  readonly name = 'ollama';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'ollama';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'ollama') {
      throw new Error('Invalid config for ollama adapter');
    }
    const baseUrl = config.baseUrl ?? 'http://localhost:11434';
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? 'No response from AI';
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Tier 1 — OpenAI ───────────────────────────────────────────────────────────

class OpenAiAdapter implements AiProviderAdapter {
  readonly name = 'openai';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'openai';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'openai') {
      throw new Error('Invalid config for openai adapter');
    }
    const baseUrl = config.baseUrl ?? 'https://api.openai.com';
    const endpoint = `${baseUrl}/v1/chat/completions`;
    return fetchOpenAiCompat(endpoint, config.model, config.apiKey, prompt);
  }
}

// ── Tier 1 — Anthropic ────────────────────────────────────────────────────────

class AnthropicAdapter implements AiProviderAdapter {
  readonly name = 'anthropic';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'anthropic';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'anthropic') {
      throw new Error('Invalid config for anthropic adapter');
    }
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
          system: SYSTEM_PROMPT,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        content?: Array<{ text?: string }>;
      };
      return data.content?.[0]?.text ?? 'No response from AI';
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Tier 2 — Google (OpenAI-compatible) ──────────────────────────────────────

class GoogleAdapter implements AiProviderAdapter {
  readonly name = 'google';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'google';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'google') {
      throw new Error('Invalid config for google adapter');
    }
    return fetchOpenAiCompat(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      config.model,
      config.apiKey,
      prompt,
    );
  }
}

// ── Tier 2 — Azure OpenAI ─────────────────────────────────────────────────────

class AzureOpenAiAdapter implements AiProviderAdapter {
  readonly name = 'azure-openai';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'azure-openai';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'azure-openai') {
      throw new Error('Invalid config for azure-openai adapter');
    }
    const endpoint = `${config.baseUrl}/openai/deployments/${config.model}/chat/completions?api-version=${config.apiVersion}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.apiKey,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? 'No response from AI';
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Tier 2 — Groq (OpenAI-compatible) ────────────────────────────────────────

class GroqAdapter implements AiProviderAdapter {
  readonly name = 'groq';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'groq';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'groq') {
      throw new Error('Invalid config for groq adapter');
    }
    return fetchOpenAiCompat(
      'https://api.groq.com/openai/v1/chat/completions',
      config.model,
      config.apiKey,
      prompt,
    );
  }
}

// ── Tier 2 — Mistral (OpenAI-compatible) ─────────────────────────────────────

class MistralAdapter implements AiProviderAdapter {
  readonly name = 'mistral';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'mistral';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'mistral') {
      throw new Error('Invalid config for mistral adapter');
    }
    return fetchOpenAiCompat(
      'https://api.mistral.ai/v1/chat/completions',
      config.model,
      config.apiKey,
      prompt,
    );
  }
}

// ── Tier 2 — OpenRouter (OpenAI-compatible) ───────────────────────────────────

class OpenRouterAdapter implements AiProviderAdapter {
  readonly name = 'openrouter';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'openrouter';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'openrouter') {
      throw new Error('Invalid config for openrouter adapter');
    }
    return fetchOpenAiCompat(
      'https://openrouter.ai/api/v1/chat/completions',
      config.model,
      config.apiKey,
      prompt,
    );
  }
}

// ── Tier 2 — Cohere (OpenAI-compatible) ──────────────────────────────────────

class CohereAdapter implements AiProviderAdapter {
  readonly name = 'cohere';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'cohere';
  }

  async createCompletion(prompt: string, config: AiProviderConfig): Promise<string> {
    if (config.provider !== 'cohere') {
      throw new Error('Invalid config for cohere adapter');
    }
    return fetchOpenAiCompat(
      'https://api.cohere.com/compatibility/v1/chat/completions',
      config.model,
      config.apiKey,
      prompt,
    );
  }
}

// ── Tier 3 — Bedrock (feature-flagged, not yet implemented) ──────────────────

class BedrockAdapter implements AiProviderAdapter {
  readonly name = 'bedrock';

  validate(config: AiProviderConfig): boolean {
    return config.provider === 'bedrock';
  }

  async createCompletion(_prompt: string, _config: AiProviderConfig): Promise<string> {
    throw new Error('Bedrock provider is not configured');
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class ProviderRegistry {
  private readonly adapters = new Map<string, AiProviderAdapter>();

  register(adapter: AiProviderAdapter): this {
    this.adapters.set(adapter.name, adapter);
    return this;
  }

  getAdapter(provider: string): AiProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  getRegisteredProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// ── Singleton registry with all providers registered ─────────────────────────

export const providerRegistry = new ProviderRegistry()
  .register(new OllamaAdapter())
  .register(new OpenAiAdapter())
  .register(new AnthropicAdapter())
  .register(new GoogleAdapter())
  .register(new AzureOpenAiAdapter())
  .register(new GroqAdapter())
  .register(new MistralAdapter())
  .register(new OpenRouterAdapter())
  .register(new CohereAdapter())
  .register(new BedrockAdapter());

// ── Config file helpers (shared across AI services) ───────────────────────────

import * as fs from 'fs/promises';
import * as path from 'path';
import { AiProviderConfigSchema } from '@automate/dashboard-shared';

const AI_CONFIG_PATH = path.join(path.resolve(process.cwd(), '.automate'), 'ai-config.json');

async function readAiProviderConfig(): Promise<AiProviderConfig | null> {
  try {
    const raw = await fs.readFile(AI_CONFIG_PATH, 'utf-8');
    return AiProviderConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Returns true if the configured provider + model supports vision/image input */
export function supportsVision(config: AiProviderConfig): boolean {
  if (config.provider === 'openai') {
    return config.model.startsWith('gpt-4o');
  }
  if (config.provider === 'google') {
    return config.model.includes('vision') || config.model.startsWith('gemini-1.5') || config.model.startsWith('gemini-2');
  }
  return false;
}

/** Get the configured AI provider adapter + config, or throw if none is configured. */
export async function getAiProvider(): Promise<{ config: AiProviderConfig; adapter: AiProviderAdapter }> {
  const config = await readAiProviderConfig();
  if (!config) throw new Error('No AI provider configured');
  const adapter = providerRegistry.getAdapter(config.provider);
  if (!adapter) throw new Error('No AI provider configured');
  return { config, adapter };
}
