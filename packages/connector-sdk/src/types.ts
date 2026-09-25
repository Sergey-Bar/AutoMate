import type { z } from 'zod/v4';

export interface ToolContext {
  credentials: Record<string, string>;
  abortSignal: AbortSignal;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  handler: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}

export interface ConnectorManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  icon: string;
  credentialSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  tools: ToolDefinition[];
}
