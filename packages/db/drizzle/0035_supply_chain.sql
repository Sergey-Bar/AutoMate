-- Supply chain: a project's latest SBOM inventory (sbom_components), the VEX documents its
-- suppliers published (vex_documents), and its licence and provenance policy
-- (supply_chain_policies). Hard-scoped from the first migration, the `0028` shape:
-- `workspace_id text NOT NULL`, a `restrict` key onto `workspaces`, and an index leading with
-- it. `ON DELETE CASCADE` on the project, as the health tables (0031) have.

CREATE TABLE IF NOT EXISTS "sbom_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "report_id" uuid,
  "purl" text,
  "name" text NOT NULL,
  "version" text,
  "type" text NOT NULL,
  "licences" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "licence_expression" text,
  "supplier" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sbom_components"
  ADD CONSTRAINT "sbom_components_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "sbom_components"
  ADD CONSTRAINT "sbom_components_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "sbom_components"
  ADD CONSTRAINT "sbom_components_report_id_health_reports_id_fk"
  FOREIGN KEY ("report_id") REFERENCES "health_reports"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sbom_components_project_idx"
  ON "sbom_components" ("workspace_id", "project_id", "branch", "purl");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sbom_components_purl_idx"
  ON "sbom_components" ("workspace_id", "purl");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vex_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "document_id" text NOT NULL,
  "author" text,
  "issued_at" text,
  "statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "report_id" uuid,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vex_documents"
  ADD CONSTRAINT "vex_documents_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "vex_documents"
  ADD CONSTRAINT "vex_documents_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "vex_documents"
  ADD CONSTRAINT "vex_documents_report_id_health_reports_id_fk"
  FOREIGN KEY ("report_id") REFERENCES "health_reports"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vex_documents_identity_idx"
  ON "vex_documents" ("workspace_id", "project_id", "document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vex_documents_order_idx"
  ON "vex_documents" ("workspace_id", "project_id", "received_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supply_chain_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "policy" jsonb NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supply_chain_policies"
  ADD CONSTRAINT "supply_chain_policies_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "supply_chain_policies"
  ADD CONSTRAINT "supply_chain_policies_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supply_chain_policies_project_idx"
  ON "supply_chain_policies" ("workspace_id", "project_id");
