import { 
  conversations, 
  messages, 
  messageAttachments, 
  connectorConfigs, 
  flowTemplates, 
  executionLog, 
  modelConfig, 
  traceLinks 
} from '@automate/db';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export { 
  conversations, 
  messages, 
  messageAttachments, 
  connectorConfigs, 
  flowTemplates, 
  executionLog, 
  modelConfig, 
  traceLinks 
};

export type Conversation = InferSelectModel<typeof conversations>;
export type NewConversation = InferInsertModel<typeof conversations>;

export type Message = InferSelectModel<typeof messages>;
export type NewMessage = InferInsertModel<typeof messages>;

export type MessageAttachment = InferSelectModel<typeof messageAttachments>;
export type NewMessageAttachment = InferInsertModel<typeof messageAttachments>;

export type ConnectorConfig = InferSelectModel<typeof connectorConfigs>;
export type NewConnectorConfig = InferInsertModel<typeof connectorConfigs>;

export type FlowTemplate = InferSelectModel<typeof flowTemplates>;
export type NewFlowTemplate = InferInsertModel<typeof flowTemplates>;

export type ExecutionLogRow = InferSelectModel<typeof executionLog>;
export type NewExecutionLogRow = InferInsertModel<typeof executionLog>;

export type ModelConfigRow = InferSelectModel<typeof modelConfig>;
export type NewModelConfig = InferInsertModel<typeof modelConfig>;

export type TraceLink = InferSelectModel<typeof traceLinks>;
export type NewTraceLink = InferInsertModel<typeof traceLinks>;
