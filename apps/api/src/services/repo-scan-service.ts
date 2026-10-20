import { scanRepository, type RepositoryView } from '@automate/projects';
import type { RepoScan, RunCommand } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

/**
 * The repository scan, cached for a few seconds, and the one place a tool id becomes an argv.
 *
 * ## Why a cache at all
 *
 * A scan walks the repository and opens every manifest and report in it. The dashboard,
 * the runner page and the toolbox each read it, and the runner page reads it again to
 * start a run; without a cache one screen would walk the tree three times in a second.
 * The window is short because a stale scan is a wrong answer about the repository — an
 * operator who adds a script and presses "rescan" passes `fresh` and gets a new walk.
 */
export interface RepoScanner {
  scan(
    projectId: string,
    repoPath: string | null,
    options?: { fresh?: boolean },
  ): Promise<RepoScan>;
}

export function createRepoScanner(options: {
  viewFor: (repoPath: string) => RepositoryView;
  ttlMs?: number;
  now?: () => number;
}): RepoScanner {
  const ttlMs = options.ttlMs ?? 15_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; scan: RepoScan }>();
  return {
    async scan(projectId, repoPath, scanOptions = {}) {
      if (repoPath === null) {
        throw new DomainError(
          ErrorCode.INVALID_REQUEST,
          `Project ${projectId} has no repository path, so there is nothing on disk to scan.`,
        );
      }
      const cached = cache.get(projectId);
      if (scanOptions.fresh !== true && cached !== undefined && now() - cached.at < ttlMs) {
        return cached.scan;
      }
      const scan = await scanRepository(options.viewFor(repoPath), new Date(now()));
      cache.set(projectId, { at: now(), scan });
      return scan;
    },
  };
}

/** What the runner is told to execute. The shape `readGenericCommand` parses. */
export interface ResolvedCommand {
  /** The id the caller sent, kept on the run so a history row says what it ran. */
  id: string;
  label: string;
  argv: string[];
  workingDirectory: string;
  artifactGlobs: string[];
  env: string[];
  evidence: 'artifact' | 'exit-code';
  /** The project's registered checkout; the runner refuses one outside its own root. */
  repository?: string;
  timeoutMs?: number;
}

/**
 * Resolves a command id to an argv, from the profile first and the scan second.
 *
 * ## Two allowlists, both written by the repository
 *
 * A **profile** command was proposed by the detector or declared in
 * `automate.config.json`, and it is a test suite: it declares the artifacts it writes,
 * so it is held to the artifact rule. A **scanned** tool is a script or a Makefile target
 * the repository declares; most are not suites, so the verdict is the exit code. Neither
 * list can be extended by the caller: the body carries an id, and an id that is in
 * neither list is a 404 rather than a guess at a nearby command.
 *
 * A scanned tool that is not runnable — a dev server, a watcher — is refused here too,
 * because a run that never exits holds a runner slot until its timeout.
 */
export function resolveCommand(
  commandId: string,
  profile: readonly RunCommand[],
  scan: RepoScan | null,
): ResolvedCommand {
  const declared = profile.find((candidate) => candidate.id === commandId);
  if (declared !== undefined) {
    return {
      id: declared.id,
      label: declared.argv.join(' '),
      argv: [...declared.argv],
      workingDirectory: '.',
      artifactGlobs: [...declared.artifactGlobs],
      env: [...declared.env],
      evidence: 'artifact',
      ...(declared.timeoutMs === undefined ? {} : { timeoutMs: declared.timeoutMs }),
    };
  }
  const tool = scan?.tools.find((candidate) => candidate.id === commandId);
  if (tool === undefined) {
    throw new DomainError(
      ErrorCode.NOT_FOUND,
      `No command ${commandId} in this project's profile or repository. Rescan, or correct it in automate.config.json.`,
    );
  }
  if (!tool.runnable) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST,
      `${tool.label} cannot be run as a job: ${tool.reason ?? 'it is not runnable.'}`,
    );
  }
  return {
    id: tool.id,
    label: tool.label,
    argv: [...tool.argv],
    workingDirectory: tool.workingDirectory,
    artifactGlobs: [],
    env: [],
    evidence: 'exit-code',
  };
}
