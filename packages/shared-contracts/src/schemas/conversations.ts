/**
 * Conversations domain schemas — Zod v4
 *
 * Covers conversation lifecycle and message contracts for the
 * Automate AI assistant and unified platform chat.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  flowTemplateId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

// ---------------------------------------------------------------------------
// ConversationMessage
// ---------------------------------------------------------------------------

export const ConversationMessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type ConversationMessageRole = z.infer<typeof ConversationMessageRoleSchema>;

export const ConversationMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: ConversationMessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// ---------------------------------------------------------------------------
// ConversationCreateRequest
// ---------------------------------------------------------------------------

export const ConversationCreateRequestSchema = z.object({
  title: z.string().optional(),
  flowTemplateId: z.string().optional(),
  systemPrompt: z.string().optional(),
  initialMessage: z.string().optional(),
});
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;
