import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import { createModelForProvider, type ModelConfig as ProviderModelConfig } from './providers.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ModelConfig = ProviderModelConfig;

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'ollama',
  model: 'llama3.1',
  endpoint: 'http://localhost:11434',
};

interface PlannerInput {
  model: unknown;
  system: string;
  prompt: string;
  tools: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
}

interface PlannerStreamConfig {
  model: unknown;
  temperature: number;
  maxTokens: number;
}

function withDefaultModelConfig(config?: ModelConfig): ModelConfig {
  return config ? { ...DEFAULT_MODEL_CONFIG, ...config } : DEFAULT_MODEL_CONFIG;
}

function createLegacyPlannerConfig(): PlannerStreamConfig {
  return {
    model: createModelForProvider(DEFAULT_MODEL_CONFIG),
    temperature: DEFAULT_MODEL_CONFIG.temperature ?? 0.7,
    maxTokens: DEFAULT_MODEL_CONFIG.maxTokens ?? 4096,
  };
}

export function createPlannerConfig(config: ModelConfig): PlannerStreamConfig {
  return {
    model: createModelForProvider(config),
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 4096,
  };
}

export function buildPlannerInput(
  userPrompt: string,
  flowPrompt: string,
  tools: Record<string, unknown>,
  config?: ModelConfig,
): PlannerInput {
  const plannerConfig = config ? createPlannerConfig(withDefaultModelConfig(config)) : createLegacyPlannerConfig();

  return {
    model: plannerConfig.model,
    system: `You are Automate orchestration planner. ${flowPrompt}`,
    prompt: userPrompt,
    tools,
    temperature: plannerConfig.temperature,
    maxTokens: plannerConfig.maxTokens,
  };
}

export function plan(userPrompt: string, flowPrompt: string, tools: Record<string, unknown>, config?: ModelConfig): unknown {
  const input = buildPlannerInput(userPrompt, flowPrompt, tools, config);
  return streamText({
    model: input.model as Parameters<typeof streamText>[0]['model'],
    system: input.system,
    prompt: input.prompt,
    tools: input.tools as unknown as ToolSet,
  });
}

export function planWithMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  tools: ToolSet,
  config?: ModelConfig,
): unknown {
  // Convert ChatMessage[] to the format expected by AI SDK (ModelMessage[])
  // Our simple message structure is compatible with ModelMessage
  const formattedMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  })) as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

  const plannerConfig = config ? createPlannerConfig(withDefaultModelConfig(config)) : createLegacyPlannerConfig();

  return streamText({
    model: plannerConfig.model as Parameters<typeof streamText>[0]['model'],
    system: systemPrompt,
    messages: formattedMessages as Parameters<typeof streamText>[0]['messages'] & {},
    tools,
  });
}
