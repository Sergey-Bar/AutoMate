#!/usr/bin/env tsx
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL ?? 'postgres://localhost:5432/automate';

console.log('🌱 Seeding Automate demo data...');
console.log(`📂 Database: ${connectionString}\n`);

const sql = postgres(connectionString);

// Date helpers
const now = new Date();
const minus = (ms: number) => new Date(now.getTime() - ms).toISOString();

const T = {
  now: now.toISOString(),
  h1: minus(1 * 3_600_000),
  h2: minus(2 * 3_600_000),
  h3: minus(3 * 3_600_000),
  h4: minus(4 * 3_600_000),
  h5: minus(5 * 3_600_000),
  h6: minus(6 * 3_600_000),
  h8: minus(8 * 3_600_000),
  h10: minus(10 * 3_600_000),
  h11: minus(11 * 3_600_000),
  h12: minus(12 * 3_600_000),
  h22: minus(22 * 3_600_000),
  h23: minus(23 * 3_600_000),
  h24: minus(24 * 3_600_000),
  h30: minus(30 * 3_600_000),
};

try {
  await sql.begin(async (tx) => {
    // ─── CLEANUP (idempotent DELETE) ────────────────────────────────────────
    console.log('🧹 Cleaning up existing demo data...');

    await tx`DELETE FROM execution_log WHERE id LIKE 'demo-%'`;
    await tx`DELETE FROM message_attachments WHERE id LIKE 'demo-%'`;
    await tx`DELETE FROM messages WHERE id LIKE 'demo-%'`;
    await tx`DELETE FROM conversations WHERE id LIKE 'demo-%'`;
    await tx`DELETE FROM connector_configs WHERE id LIKE 'demo-%'`;

    console.log('✅ Cleanup complete\n');

    // ─── CONVERSATIONS (5) ──────────────────────────────────────────────────
    console.log('📦 Seeding conversations (5)...');

    await tx`INSERT INTO conversations (id, title, flow_template_id, created_at, updated_at) VALUES
      ('demo-conv-1', 'Regression gate: Sprint 42 release', 'regression-gate', ${T.h24}, ${T.h22}),
      ('demo-conv-2', 'Investigate flaky login tests', NULL, ${T.h12}, ${T.h10}),
      ('demo-conv-3', 'Generate API endpoint tests', NULL, ${T.h6}, ${T.h4}),
      ('demo-conv-4', 'Review PR #847 test coverage', NULL, ${T.h3}, ${T.h2}),
      ('demo-conv-5', 'Debug timeout in checkout flow', NULL, ${T.h1}, ${T.now})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at`;

    // ─── MESSAGES ──────────────────────────────────────────────────────────
    console.log('📦 Seeding messages...');

    const messages = [
      ['demo-msg-1-1', 'demo-conv-1', 'system', 'You are a QA orchestration assistant. Use playwright, jira, and slack tools in order to run regression tests, file issues, and post summaries.', null, null, null, T.h24],
      ['demo-msg-1-2', 'demo-conv-1', 'user', 'Run the full regression suite for Sprint 42 and create Jira tickets for any failures, then post a summary to #qa-alerts.', null, null, null, T.h24],
      ['demo-msg-1-3', 'demo-conv-1', 'assistant', "I'll run the regression suite, file tickets for failures, and post the summary. Starting with the test run now.", null, null, null, T.h23],
      ['demo-msg-1-4', 'demo-conv-1', 'tool', JSON.stringify({ issueKey: 'QA-1234', summary: 'Regression suite Sprint 42: 3 failures detected', url: 'https://jira.example.com/browse/QA-1234' }), 'tcall-001', 'jira.create_issue', null, T.h22],
      ['demo-msg-1-5', 'demo-conv-1', 'assistant', 'Regression gate complete. Created QA-1234 for 3 failures. Summary posted to #qa-alerts.', null, null, null, T.h22],
      ['demo-msg-2-1', 'demo-conv-2', 'user', 'The login tests have been flaky for the past week. Can you investigate?', null, null, null, T.h12],
      ['demo-msg-2-2', 'demo-conv-2', 'assistant', "I'll check the recent test results and look for patterns in the failures.", null, null, null, T.h12],
      ['demo-msg-2-3', 'demo-conv-2', 'tool', JSON.stringify({ rows: [{ test: 'login_flow', failure_rate: 0.34 }] }), 'tcall-002', 'sql-browser.query', null, T.h11],
      ['demo-msg-2-4', 'demo-conv-2', 'tool', JSON.stringify({ issues: [{ key: 'QA-1100', title: 'Login timeout on slow networks' }] }), 'tcall-003', 'github.search_issues', null, T.h11],
      ['demo-msg-2-5', 'demo-conv-2', 'assistant', 'Root cause found: login tests fail 34% of the time due to network timeout. Related to QA-1100.', null, null, null, T.h10],
      ['demo-msg-3-1', 'demo-conv-3', 'user', 'Generate tests for the new /api/v2/orders endpoint.', null, null, null, T.h6],
      ['demo-msg-3-2', 'demo-conv-3', 'assistant', "I'll analyze the OpenAPI spec and generate comprehensive tests for the orders endpoint.", null, null, null, T.h6],
      ['demo-msg-3-3', 'demo-conv-3', 'assistant', 'Generated 12 test cases covering happy path, validation errors, auth, and edge cases.', null, null, null, T.h5],
      ['demo-msg-4-1', 'demo-conv-4', 'user', 'Review test coverage for PR #847.', null, null, null, T.h3],
      ['demo-msg-4-2', 'demo-conv-4', 'assistant', 'PR #847 adds 3 new endpoints. Current coverage: 78%. Missing: error handling for 422 responses.', null, null, null, T.h2],
      ['demo-msg-5-1', 'demo-conv-5', 'user', 'The checkout flow times out after 30s in CI. Help debug.', null, null, null, T.h1],
      ['demo-msg-5-2', 'demo-conv-5', 'assistant', 'Analyzing the checkout flow timeout. Checking recent CI logs and test history.', null, null, null, T.h1],
    ];

    for (const [id, conversationId, role, content, toolCallId, toolName, metadata, createdAt] of messages) {
      await tx`INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, metadata, created_at)
        VALUES (${id}, ${conversationId}, ${role}, ${content}, ${toolCallId}, ${toolName}, ${metadata}, ${createdAt})
        ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`;
    }

    // ─── ATTACHMENTS ────────────────────────────────────────────────────────
    console.log('📦 Seeding attachments...');

    await tx`INSERT INTO message_attachments (id, message_id, name, content_type, path, size_bytes) VALUES
      ('demo-attach-1', 'demo-msg-1-4', 'jira-ticket.json', 'application/json', 'attachments/jira.json', 2048),
      ('demo-attach-2', 'demo-msg-2-3', 'results.json', 'application/json', 'attachments/results.json', 512)
      ON CONFLICT (id) DO NOTHING`;

    // ─── CONNECTORS ─────────────────────────────────────────────────────────
    console.log('📦 Seeding connector configs...');

    await tx`INSERT INTO connector_configs (id, connector_name, enabled, credential_ref, settings, updated_at) VALUES
      ('demo-connector-github', 'github', TRUE, 'vault:github-token', '{}', ${T.now}),
      ('demo-connector-jira', 'jira', TRUE, 'vault:jira-creds', '{}', ${T.now})
      ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`;

    // ─── EXECUTION LOG ───────────────────────────────────────────────────────
    console.log('📦 Seeding execution log...');

    await tx`INSERT INTO execution_log (id, conversation_id, tool_name, input, output, status, duration_ms, error_message, created_at) VALUES
      ('demo-exec-1', 'demo-conv-1', 'jira.create_issue', '{}', '{}', 'success', 842, NULL, ${T.h22}),
      ('demo-exec-2', NULL, 'github.create_issue', '{}', NULL, 'error', 5000, 'rate limit', ${T.h12}),
      ('demo-exec-3', 'demo-conv-2', 'sql-browser.query', '{}', '{}', 'success', 134, NULL, ${T.h11})
      ON CONFLICT (id) DO NOTHING`;
  });

  console.log('\n✅ Demo seed complete!');
} catch (err) {
  console.error('❌ Seed failed:', (err as Error).message);
  process.exit(1);
} finally {
  await sql.end();
}
