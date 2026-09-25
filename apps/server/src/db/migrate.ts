import { sql } from 'drizzle-orm';
import { db } from './client.js';

export function buildMigrationSql(): string {
  return [
    'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, flow_template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, tool_call_id TEXT, tool_name TEXT, metadata TEXT, created_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);',
    'CREATE TABLE IF NOT EXISTS message_attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, path TEXT NOT NULL, size_bytes INTEGER, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE);',
    'CREATE TABLE IF NOT EXISTS connector_configs (id TEXT PRIMARY KEY, connector_name TEXT NOT NULL, enabled BOOLEAN DEFAULT FALSE, credential_ref TEXT, settings TEXT, updated_at TEXT NOT NULL, CONSTRAINT connector_configs_connector_name_unique UNIQUE (connector_name));',
    'CREATE TABLE IF NOT EXISTS flow_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, system_prompt TEXT NOT NULL, steps TEXT, category TEXT, is_built_in BOOLEAN DEFAULT FALSE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS execution_log (id TEXT PRIMARY KEY, conversation_id TEXT, tool_name TEXT NOT NULL, input TEXT NOT NULL, output TEXT, status TEXT NOT NULL, duration_ms INTEGER, error_message TEXT, created_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id));',
    "CREATE TABLE IF NOT EXISTS model_config (id TEXT PRIMARY KEY DEFAULT 'default', provider TEXT NOT NULL DEFAULT 'ollama', model TEXT NOT NULL DEFAULT 'llama3.1', endpoint TEXT NOT NULL DEFAULT 'http://localhost:11434', temperature DOUBLE PRECISION DEFAULT 0.7, max_tokens INTEGER DEFAULT 4096, system_prompt TEXT, updated_at TEXT NOT NULL);",
    'CREATE TABLE IF NOT EXISTS trace_links (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, link_type TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL, created_by TEXT);',
    'CREATE INDEX IF NOT EXISTS trace_links_source_idx ON trace_links (source_type, source_id);',
    'CREATE INDEX IF NOT EXISTS trace_links_target_idx ON trace_links (target_type, target_id);',
    'CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON conversations (created_at);',
    'CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx ON messages (conversation_id, created_at);',
    'CREATE INDEX IF NOT EXISTS execution_log_conversation_id_idx ON execution_log (conversation_id);',
    'CREATE INDEX IF NOT EXISTS execution_log_created_at_idx ON execution_log (created_at);',
  ].join('\n');
}

export async function migrateDb(): Promise<void> {
  await db.execute(sql.raw(buildMigrationSql()));
}

export async function runDrizzleMigrations(): Promise<void> {
  await migrateDb();
}
