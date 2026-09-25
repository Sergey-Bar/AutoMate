/**
 * model-config.ts — In-memory model configuration store and routes
 *
 * GET  /api/v1/orchestrator/model-config  — return current model config
 * PUT  /api/v1/orchestrator/model-config  — update model config
 */
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ModelConfig {
  model: string;
  provider: string;
  endpoint: string;
  temperature: number;
  maxTokens: number;
}

const VALID_PROVIDERS = ['ollama', 'openai', 'anthropic', 'google'] as const;

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface ModelConfigStore {
  get(): ModelConfig;
  update(partial: Partial<ModelConfig>): ModelConfig;
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  model: 'llama3.1',
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
  temperature: 0.7,
  maxTokens: 4096,
};

/**
 * In-memory (transient) implementation of ModelConfigStore.
 * State is lost when the process restarts. For production, replace with a
 * Drizzle-backed implementation that persists to Postgres.
 */
export class InMemoryModelConfigStore implements ModelConfigStore {
  private _config: ModelConfig = { ...DEFAULT_MODEL_CONFIG };

  get(): ModelConfig {
    return { ...this._config };
  }

  update(partial: Partial<ModelConfig>): ModelConfig {
    this._config = { ...this._config, ...partial };
    return { ...this._config };
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateModelConfigUpdate(body: Record<string, unknown>): string | null {
  if (body['provider'] !== undefined) {
    if (typeof body['provider'] !== 'string') {
      return 'provider must be a string';
    }
    if (!(VALID_PROVIDERS as readonly string[]).includes(body['provider'])) {
      return `provider must be one of: ${VALID_PROVIDERS.join(', ')}`;
    }
  }

  if (body['model'] !== undefined && typeof body['model'] !== 'string') {
    return 'model must be a string';
  }

  if (body['endpoint'] !== undefined) {
    if (typeof body['endpoint'] !== 'string') {
      return 'endpoint must be a string';
    }
    try {
      new URL(body['endpoint']);
    } catch {
      return 'endpoint must be a valid URL';
    }
  }

  if (body['temperature'] !== undefined) {
    if (typeof body['temperature'] !== 'number' || !Number.isFinite(body['temperature'])) {
      return 'temperature must be a finite number';
    }
    if (body['temperature'] < 0 || body['temperature'] > 2) {
      return 'temperature must be between 0 and 2';
    }
  }

  if (body['maxTokens'] !== undefined) {
    if (typeof body['maxTokens'] !== 'number' || !Number.isFinite(body['maxTokens']) || !Number.isInteger(body['maxTokens'])) {
      return 'maxTokens must be a finite integer';
    }
    if (body['maxTokens'] < 1) {
      return 'maxTokens must be a positive integer';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface OrchestratorModelConfigOptions {
  store: ModelConfigStore;
}

export function createOrchestratorModelConfigRoutes(
  options: OrchestratorModelConfigOptions,
): Hono {
  const app = new Hono();

  // ── GET /api/v1/orchestrator/model-config ─────────────────────────────────
  app.get('/api/v1/orchestrator/model-config', (c) => {
    return c.json(options.store.get());
  });

  // ── PUT /api/v1/orchestrator/model-config ─────────────────────────────────
  app.put('/api/v1/orchestrator/model-config', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;

    const validationError = validateModelConfigUpdate(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const partial: Partial<ModelConfig> = {};
    if (typeof body['model'] === 'string') partial.model = body['model'];
    if (typeof body['provider'] === 'string') partial.provider = body['provider'];
    if (typeof body['endpoint'] === 'string') partial.endpoint = body['endpoint'];
    if (typeof body['temperature'] === 'number') partial.temperature = body['temperature'];
    if (typeof body['maxTokens'] === 'number') partial.maxTokens = body['maxTokens'];

    const updated = options.store.update(partial);
    return c.json(updated);
  });

  return app;
}
