/**
 * Triage labels: what a recurring failure is, decided once and applied to every recurrence.
 *
 * The key is `failureSignature` (`@automate/reporting`) — the key the insights page clusters
 * on and the per-test history groups by — so a label given today labels the same cause
 * tomorrow, in any test, without anyone re-reading it. Stored in `fingerprint_categories`,
 * which 0048 scoped to the workspace; the categories are `defect_categories` rows it seeded.
 */

import { and, asc, eq } from 'drizzle-orm';
import { fingerprintCategories } from '@automate/db';
import type { TriageCategory, TriageLabel, TriageLabelBody } from '@automate/shared-contracts';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

function toLabel(row: typeof fingerprintCategories.$inferSelect): TriageLabel {
  return {
    signature: row.fingerprint,
    category: row.categoryId as TriageCategory,
    issueUrl: row.issueUrl ?? null,
    labelledAt: row.assignedAt.toISOString(),
    labelledBy: row.labelledBy,
  };
}

export async function listTriageLabels(options: Options): Promise<TriageLabel[]> {
  const rows = await options.db
    .select()
    .from(fingerprintCategories)
    .where(eq(fingerprintCategories.workspaceId, options.workspaceId))
    .orderBy(asc(fingerprintCategories.fingerprint));
  return rows.map(toLabel);
}

export async function setTriageLabel(
  options: Options,
  body: TriageLabelBody,
  actor: string,
  now: Date = new Date(),
): Promise<TriageLabel> {
  const values = {
    workspaceId: options.workspaceId,
    fingerprint: body.signature,
    categoryId: body.category,
    issueUrl: body.issueUrl ?? null,
    assignedAt: now,
    labelledBy: actor,
  };
  const [row] = await options.db
    .insert(fingerprintCategories)
    .values(values)
    .onConflictDoUpdate({
      target: [fingerprintCategories.workspaceId, fingerprintCategories.fingerprint],
      set: {
        categoryId: values.categoryId,
        issueUrl: values.issueUrl,
        assignedAt: values.assignedAt,
        labelledBy: values.labelledBy,
      },
    })
    .returning();
  return toLabel(row as typeof fingerprintCategories.$inferSelect);
}

export async function deleteTriageLabel(options: Options, signature: string): Promise<boolean> {
  const removed = await options.db
    .delete(fingerprintCategories)
    .where(
      and(
        eq(fingerprintCategories.workspaceId, options.workspaceId),
        eq(fingerprintCategories.fingerprint, signature),
      ),
    )
    .returning({ fingerprint: fingerprintCategories.fingerprint });
  return removed.length > 0;
}

/**
 * The insights clusters with their label, and how many failures nobody has labelled. Pure,
 * so the insights route and the pull-request comment read labels the same way.
 */
export function labelClusters<
  C extends { signature: string; count: number },
  T extends { failures: number; causes: number },
>(
  clustered: { clusters: readonly C[]; totals: T },
  labels: readonly TriageLabel[],
): {
  clusters: Array<C & { label: { category: TriageCategory; issueUrl: string | null } | null }>;
  totals: T & { unlabelled: number };
} {
  const bySignature = new Map(labels.map((label) => [label.signature, label]));
  const clusters = clustered.clusters.map((cluster) => {
    const label = bySignature.get(cluster.signature);
    return {
      ...cluster,
      label: label === undefined ? null : { category: label.category, issueUrl: label.issueUrl },
    };
  });
  const labelledFailures = clusters
    .filter((cluster) => cluster.label !== null)
    .reduce((sum, cluster) => sum + cluster.count, 0);
  return {
    clusters,
    totals: {
      ...clustered.totals,
      unlabelled: Math.max(0, clustered.totals.failures - labelledFailures),
    },
  };
}
