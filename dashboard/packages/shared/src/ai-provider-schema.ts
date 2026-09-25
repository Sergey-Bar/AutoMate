import { z } from 'zod';

// ─── AI Provider enum ─────────────────────────────────────────────────────

/**
 * All supported AI providers for the Dashboard AI Explain feature.
 * Matches the provider enum used in Automate.
 */
export const AiProviderSchema = z.enum([
  'ollama',
  'openai',
  'anthropic',
  'google',
  'azure-openai',
  'groq',
  'mistral',
  'openrouter',
  'cohere',
  'bedrock',
]);

export type AiProvider = z.infer<typeof AiProviderSchema>;

// ─── Per-provider config schemas ──────────────────────────────────────────

/**
 * Ollama — local LLM server. No API key required.
 * baseUrl defaults to http://localhost:11434 when absent.
 */
const OllamaConfigSchema = z.object({
  provider: z.literal('ollama'),
  model: z.string(),
  baseUrl: z.string().url().optional(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * OpenAI — official API or compatible endpoint.
 * baseUrl is optional (use for proxies / custom endpoints).
 */
const OpenAiConfigSchema = z.object({
  provider: z.literal('openai'),
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().url().optional(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * Anthropic — Claude API.
 */
const AnthropicConfigSchema = z.object({
  provider: z.literal('anthropic'),
  model: z.string(),
  apiKey: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * Google — Gemini API.
 */
const GoogleConfigSchema = z.object({
  provider: z.literal('google'),
  model: z.string(),
  apiKey: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * Azure OpenAI — requires endpoint (baseUrl), apiVersion, and API key.
 */
const AzureOpenAiConfigSchema = z.object({
  provider: z.literal('azure-openai'),
  model: z.string(),
  apiKey: z.string(),
  /** Azure resource endpoint, e.g. https://<resource>.openai.azure.com */
  baseUrl: z.string().url(),
  /** Azure OpenAI API version, e.g. "2024-02-01" */
  apiVersion: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * Groq — fast inference API (OpenAI-compatible).
 */
const GroqConfigSchema = z.object({
  provider: z.literal('groq'),
  model: z.string(),
  apiKey: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * Mistral AI — official API.
 */
const MistralConfigSchema = z.object({
  provider: z.literal('mistral'),
  model: z.string(),
  apiKey: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * OpenRouter — unified LLM gateway.
 */
const OpenRouterConfigSchema = z.object({
  provider: z.literal('openrouter'),
  model: z.string(),
  apiKey: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * Cohere — Command R / Command R+ models.
 */
const CohereConfigSchema = z.object({
  provider: z.literal('cohere'),
  model: z.string(),
  apiKey: z.string(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

/**
 * AWS Bedrock — uses AWS credentials instead of a single API key.
 */
const BedrockConfigSchema = z.object({
  provider: z.literal('bedrock'),
  model: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  region: z.string(),
  /** Optional STS session token for temporary credentials. */
  sessionToken: z.string().optional(),
  dualAgentRca: z.boolean().optional(),
  visionDiffEnabled: z.boolean().optional(),
  visionDiffThreshold: z.number().optional(),
});

// ─── Discriminated union ──────────────────────────────────────────────────

/**
 * Provider config — discriminated union on `provider`.
 * Each variant carries only the fields relevant to that provider.
 */
export const AiProviderConfigSchema = z.discriminatedUnion('provider', [
  OllamaConfigSchema,
  OpenAiConfigSchema,
  AnthropicConfigSchema,
  GoogleConfigSchema,
  AzureOpenAiConfigSchema,
  GroqConfigSchema,
  MistralConfigSchema,
  OpenRouterConfigSchema,
  CohereConfigSchema,
  BedrockConfigSchema,
]);

export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;
