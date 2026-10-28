import { inArray } from 'drizzle-orm';
import { runners } from '@automate/db';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * The scanners the runner pool can run: what every live runner advertises in
 * `RUNNER_CAPABILITIES`. The health scan of any workspace is offered these, and a scanner no
 * live runner has is reported as not configured.
 *
 * **Not filtered by workspace** (ADR-014): runners are one pool the installation shares. Every
 * runner registers in the default workspace and claims any workspace's jobs, so filtering by
 * the asking workspace offered every other workspace no runners at all, and every scanner there
 * read as not configured although the pool would have run it.
 */
export async function poolCapabilities(
  options: Pick<ProjectRegistryServiceOptions, 'db'>,
): Promise<Set<string>> {
  const rows = await options.db
    .select({ capabilities: runners.capabilities })
    .from(runners)
    .where(inArray(runners.health, ['healthy', 'degraded']));
  return new Set(rows.flatMap((row) => row.capabilities));
}
