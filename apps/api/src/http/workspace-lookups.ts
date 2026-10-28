import { and, asc, eq, isNull } from 'drizzle-orm';
import { accessTokens, executionJobs, workspaceMembers, workspaces } from '@automate/db';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import { hashToken } from '../services/access-service.js';
import { JOB_ID_PATTERN, type WorkspaceLookups } from './workspace-dispatch.js';

export interface DatabaseWorkspaceLookupsOptions extends Pick<ProjectRegistryServiceOptions, 'db'> {
  defaultWorkspace: string;
  sessionUser: WorkspaceLookups['sessionUser'];
  installationLevel: WorkspaceLookups['installationLevel'];
}

/**
 * The rows a request's workspace is read from (ADR-014, team): a live token's own workspace, a
 * job's, a person's memberships oldest first, and whether a workspace exists. The session and
 * the installation-admin check are the composition's own, passed in. A job id that is not a
 * uuid is no job, and is answered without a query: PostgreSQL would refuse it as malformed.
 */
export function createDatabaseWorkspaceLookups(
  options: DatabaseWorkspaceLookupsOptions,
): WorkspaceLookups {
  const { db } = options;
  return {
    defaultWorkspace: options.defaultWorkspace,
    tokenWorkspace: async (token) =>
      (
        await db
          .select({ workspaceId: accessTokens.workspaceId })
          .from(accessTokens)
          .where(and(eq(accessTokens.tokenHash, hashToken(token)), isNull(accessTokens.revokedAt)))
          .limit(1)
      )[0]?.workspaceId ?? null,
    jobWorkspace: async (jobId) =>
      JOB_ID_PATTERN.test(jobId)
        ? ((
            await db
              .select({ workspaceId: executionJobs.workspaceId })
              .from(executionJobs)
              .where(eq(executionJobs.id, jobId))
              .limit(1)
          )[0]?.workspaceId ?? null)
        : null,
    sessionUser: options.sessionUser,
    memberships: async (userId) =>
      (
        await db
          .select({ workspaceId: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.userId, userId))
          .orderBy(asc(workspaceMembers.createdAt))
      ).map((row) => row.workspaceId),
    installationLevel: options.installationLevel,
    workspaceExists: async (workspaceId) =>
      (
        await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1)
      ).length === 1,
  };
}
