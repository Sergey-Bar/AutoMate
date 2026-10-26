-- Agent quality. Five tables, each hard-scoped from its first migration, the `0028` shape:
-- `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and every index leading with it.
--
-- `eval_runs` / `eval_cases`: one uploaded or built-in eval run and its cases. A case keeps its
-- prompt text only when the project's policy says `agents.storePrompts`; its sha256 always.
-- `genai_spans`: OTLP GenAI spans, and the installation's own chat completions. A chat span has
-- no project (`source = 'self'`, `project_id` NULL) and is still in the installation's
-- workspace. Every span carries the instant it expires, from the project's retention policy.
-- `mcp_servers`: the MCP server inventory of a project's branch, replaced by every scan. Only
-- environment variable NAMES are kept, never a value.
-- `eval_datasets`: the built-in eval runner's datasets, one per (project, name).

CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Arrival order: "the newest run of a suite" is the highest sequence.
  "sequence" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "commit_sha" text,
  "suite" text NOT NULL,
  "format" text NOT NULL,
  "source" text NOT NULL,
  "tool_name" text NOT NULL,
  "tool_version" text,
  "model" text,
  "provider" text,
  "config_hash" text NOT NULL,
  "totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "truncated" boolean DEFAULT false NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "eval_runs_source_check" CHECK ("source" IN ('ci', 'runner', 'manual')),
  CONSTRAINT "eval_runs_format_check"
    CHECK ("format" IN ('promptfoo-json', 'deepeval-json', 'inspect-eval-json', 'automate-eval-json'))
);
--> statement-breakpoint
ALTER TABLE "eval_runs"
  ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "eval_runs"
  ADD CONSTRAINT "eval_runs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_runs_latest_idx"
  ON "eval_runs" ("workspace_id", "project_id", "branch", "suite", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_runs_recent_idx"
  ON "eval_runs" ("workspace_id", "project_id", "sequence");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "case_id" text NOT NULL,
  "label" text NOT NULL,
  "prompt_hash" text,
  "prompt" text,
  "attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "eval_cases_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "eval_cases"
  ADD CONSTRAINT "eval_cases_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "eval_cases"
  ADD CONSTRAINT "eval_cases_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "eval_cases"
  ADD CONSTRAINT "eval_cases_run_id_eval_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "eval_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_cases_run_idx"
  ON "eval_cases" ("workspace_id", "run_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genai_spans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid,
  "source" text NOT NULL,
  "trace_id" text NOT NULL,
  "span_id" text NOT NULL,
  "parent_span_id" text,
  "operation" text NOT NULL,
  "provider" text,
  "request_model" text,
  "response_model" text,
  "agent_name" text,
  "tool_name" text,
  "tool_args_hash" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "started_at" timestamp with time zone NOT NULL,
  "duration_ms" real NOT NULL,
  "status" text NOT NULL,
  "error_type" text,
  "service_name" text,
  "content" jsonb,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "genai_spans_source_check" CHECK ("source" IN ('otlp', 'self')),
  CONSTRAINT "genai_spans_status_check" CHECK ("status" IN ('ok', 'error', 'unset')),
  CONSTRAINT "genai_spans_project_check"
    CHECK (("source" = 'self') = ("project_id" IS NULL)),
  CONSTRAINT "genai_spans_counts_check"
    CHECK ("duration_ms" >= 0 AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
      AND ("output_tokens" IS NULL OR "output_tokens" >= 0))
);
--> statement-breakpoint
ALTER TABLE "genai_spans"
  ADD CONSTRAINT "genai_spans_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "genai_spans"
  ADD CONSTRAINT "genai_spans_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "genai_spans_span_idx"
  ON "genai_spans" ("workspace_id", "project_id", "trace_id", "span_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genai_spans_window_idx"
  ON "genai_spans" ("workspace_id", "project_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genai_spans_expiry_idx"
  ON "genai_spans" ("workspace_id", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "name" text NOT NULL,
  "config_path" text NOT NULL,
  "transport" text NOT NULL,
  "command" text,
  "package" text,
  "version" text,
  "pinned" boolean DEFAULT false NOT NULL,
  "url" text,
  "env_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "commit_sha" text,
  "scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_servers_transport_check"
    CHECK ("transport" IN ('stdio', 'http', 'sse', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "mcp_servers"
  ADD CONSTRAINT "mcp_servers_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "mcp_servers"
  ADD CONSTRAINT "mcp_servers_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_servers_project_idx"
  ON "mcp_servers" ("workspace_id", "project_id", "branch");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_datasets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "model" text NOT NULL,
  "repeats" integer DEFAULT 3 NOT NULL,
  "judge" jsonb,
  "cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "eval_datasets_repeats_check" CHECK ("repeats" >= 1 AND "repeats" <= 20)
);
--> statement-breakpoint
ALTER TABLE "eval_datasets"
  ADD CONSTRAINT "eval_datasets_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "eval_datasets"
  ADD CONSTRAINT "eval_datasets_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_datasets_name_idx"
  ON "eval_datasets" ("workspace_id", "project_id", "name");
