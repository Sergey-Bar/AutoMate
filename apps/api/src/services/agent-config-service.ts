import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { mcpServers } from '@automate/db';
import {
  AGENT_CONFIG_RULES,
  AGENT_CONFIG_TOOL,
  DEFAULT_IGNORED,
  isAgentConfigPath,
  redactServerUrl,
  scanAgentConfig,
  type AgentConfigFile,
} from '@automate/projects';
import {
  MAX_AGENT_CONFIG_FILE_BYTES,
  MAX_AGENT_CONFIG_FILES,
  type AgentConfigScanResult,
  type HealthDimension,
  type HealthUploadResult,
  type McpServerList,
} from '@automate/shared-contracts';
import { branchFor, projectRow } from './health-findings.js';
import type { EvalOptions } from './eval-service.js';
import type { ParsedReport, UploadInput } from './repo-health-service.js';

/**
 * The built-in agent-config scanner: a project's agent instructions and MCP configuration,
 * scanned by `scanAgentConfig` (`@automate/projects`) and ingested as health findings.
 *
 * **This is the product scanning a user's repository. It is not this repository's own
 * `pnpm skill-scan` gate**, which wraps SkillSpector over `.kilo/skills/` and has its own
 * baseline; the two share nothing but the problem they look at.
 *
 * ## Where the files come from
 *
 * - A project with a local checkout (`repoPath`): {@link collectAgentConfigFiles} walks it,
 *   when `POST /health/scan` runs. The walk never follows a symbolic link, skips `.git` and the
 *   dependency directories, never reads the local-only files {@link isLocalOnly} names, and
 *   stops at {@link MAX_AGENT_CONFIG_FILES} files of at most
 *   {@link MAX_AGENT_CONFIG_FILE_BYTES} each.
 * - A project with no checkout here (git-sourced, CI-only): its CI sends the files to
 *   `POST /health/agent-config`. A runner-cloned scan is not built: the runner's job modes run
 *   commands and upload declared artifacts, and none of them collects a file set.
 *
 * ## What is stored
 *
 * Findings under the tool key `automate-agent-config`, through the shared finding lifecycle
 * (`ingestParsedReport` → `syncFindings`), so a removed instruction is `fixed` by the next
 * scan exactly as a SARIF finding is. The MCP server inventory per (project, branch), replaced
 * by every scan, with environment variable **names** only and each server URL with its
 * userinfo and fragment removed and every query value replaced by `REDACTED`.
 */
export interface AgentConfigOptions extends EvalOptions {
  /** The health ingestion with its hooks, so findings grade and alert as any scanner's. */
  ingestParsed: (
    input: Omit<UploadInput, 'bytes'>,
    parsed: ParsedReport,
  ) => Promise<HealthUploadResult>;
}

/** Entries visited by one walk before it stops: a bound on a pathological tree. */
export const MAX_WALK_ENTRIES = 50_000;
const MAX_DEPTH = 16;
/** Directories never walked. `.git` is the largest and holds no agent configuration. */
const SKIPPED = new Set(['.git', ...DEFAULT_IGNORED]);

/**
 * Files the walk never reads: a developer's local overrides, conventionally untracked and
 * where tokens are pasted (`.claude/settings.local.json`, any `*.local.json`, and Claude
 * Desktop's `claude_desktop_config.json`). The API process runs no subprocess, so it cannot
 * ask git which files are tracked; skipping by name is the safer option it has. A file that
 * was committed reaches the scan anyway through CI's `POST /health/agent-config`.
 */
function isLocalOnly(relative: string): boolean {
  const name = relative.slice(relative.lastIndexOf('/') + 1).toLowerCase();
  return name.endsWith('.local.json') || name === 'claude_desktop_config.json';
}

const DIMENSIONS: HealthDimension[] = [
  ...new Set(Object.values(AGENT_CONFIG_RULES).map((rule) => rule.dimension)),
];

interface Walk {
  root: string;
  files: AgentConfigFile[];
  visited: number;
  ignored: number;
}

async function readCandidate(walk: Walk, full: string, relative: string): Promise<void> {
  const stats = await lstat(full);
  if (!stats.isFile() || stats.size > MAX_AGENT_CONFIG_FILE_BYTES) {
    walk.ignored += 1;
    return;
  }
  walk.files.push({ path: relative, text: await readFile(full, 'utf8') });
}

async function walkDirectory(walk: Walk, directory: string, depth: number): Promise<void> {
  if (depth > MAX_DEPTH) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (walk.visited >= MAX_WALK_ENTRIES || walk.files.length >= MAX_AGENT_CONFIG_FILES) return;
    walk.visited += 1;
    await visitEntry(walk, path.join(directory, entry.name), entry, depth);
  }
}

async function visitEntry(walk: Walk, full: string, entry: Dirent, depth: number): Promise<void> {
  // A symbolic link is never followed, to a file or a directory: it can point outside.
  if (entry.isSymbolicLink()) return;
  if (entry.isDirectory()) {
    if (!SKIPPED.has(entry.name)) await walkDirectory(walk, full, depth + 1);
    return;
  }
  const relative = path.relative(walk.root, full).split(path.sep).join('/');
  if (entry.isFile() && isAgentConfigPath(relative) && !isLocalOnly(relative)) {
    await readCandidate(walk, full, relative);
  }
}

/** The agent-config files of a local checkout, bounded, never following a link. */
export async function collectAgentConfigFiles(
  root: string,
): Promise<{ files: AgentConfigFile[]; ignored: number }> {
  const walk: Walk = { root: path.resolve(root), files: [], visited: 0, ignored: 0 };
  await walkDirectory(walk, walk.root, 0);
  return { files: walk.files, ignored: walk.ignored };
}

/** A sent path, repository-relative with forward slashes, or `null` if it climbs out. */
function relativePath(raw: string): string | null {
  const normalised = path.posix.normalize(raw.replace(/\\/gu, '/')).replace(/^\.\//u, '');
  if (normalised.startsWith('../') || normalised === '..' || path.posix.isAbsolute(normalised)) {
    return null;
  }
  return normalised;
}

/** Files a caller sent, kept only when they are agent configuration inside the repository. */
function admissible(files: readonly AgentConfigFile[]): {
  files: AgentConfigFile[];
  ignored: number;
} {
  const kept: AgentConfigFile[] = [];
  for (const file of files.slice(0, MAX_AGENT_CONFIG_FILES)) {
    const relative = relativePath(file.path);
    if (relative !== null && isAgentConfigPath(relative))
      kept.push({ path: relative, text: file.text });
  }
  return { files: kept, ignored: files.length - kept.length };
}

export interface AgentConfigInput {
  branch?: string | undefined;
  commit?: string | undefined;
  files: readonly AgentConfigFile[];
  source: 'ci' | 'runner' | 'manual';
}

/** Scans the files, ingests the findings, and replaces the branch's MCP inventory. */
export async function ingestAgentConfig(
  options: AgentConfigOptions,
  projectId: string,
  input: AgentConfigInput,
): Promise<AgentConfigScanResult> {
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, input.branch);
  const { files, ignored } = admissible(input.files);
  const scan = scanAgentConfig(files);
  const result = await options.ingestParsed(
    {
      projectId: project.id,
      format: 'automate-agent-config',
      branch,
      commitSha: input.commit,
      source: input.source,
    },
    {
      tools: [{ tool: { name: AGENT_CONFIG_TOOL, version: null }, dimensions: DIMENSIONS }],
      findings: scan.findings,
      metrics: [],
    },
  );
  await replaceInventory(options, project.id, result.branch, input.commit, scan.mcpServers);
  return {
    branch: result.branch,
    filesScanned: scan.filesScanned,
    ignored,
    findings: result.findings,
    mcpServers: scan.mcpServers.length,
  };
}

async function replaceInventory(
  options: EvalOptions,
  projectId: string,
  branch: string,
  commit: string | undefined,
  servers: ReturnType<typeof scanAgentConfig>['mcpServers'],
): Promise<void> {
  const now = options.now?.() ?? new Date();
  await options.db.transaction(async (tx) => {
    await tx
      .delete(mcpServers)
      .where(
        and(
          eq(mcpServers.workspaceId, options.workspaceId),
          eq(mcpServers.projectId, projectId),
          eq(mcpServers.branch, branch),
        ),
      );
    if (servers.length === 0) return;
    await tx.insert(mcpServers).values(
      servers.slice(0, 500).map((server) => ({
        workspaceId: options.workspaceId,
        projectId,
        branch,
        name: server.name.slice(0, 200),
        configPath: server.configPath.slice(0, 1000),
        transport: server.transport,
        command: server.command?.slice(0, 500) ?? null,
        package: server.package?.slice(0, 500) ?? null,
        version: server.version?.slice(0, 200) ?? null,
        pinned: server.pinned,
        url: server.url === null ? null : redactServerUrl(server.url).slice(0, 2000),
        envKeys: server.envKeys.slice(0, 100).map((key) => key.slice(0, 200)),
        commitSha: commit?.toLowerCase() ?? null,
        scannedAt: now,
      })),
    );
  });
}

/**
 * The built-in scan of a local checkout, for `POST /health/scan`. `null` when the project has
 * no checkout here — the scan route then reports only the runner scanners.
 */
export async function scanLocalAgentConfig(
  options: AgentConfigOptions,
  projectId: string,
): Promise<string | null> {
  const project = await projectRow(options, projectId);
  if (project.repoPath === null) return null;
  const { files } = await collectAgentConfigFiles(project.repoPath);
  await ingestAgentConfig(options, project.id, { files, source: 'runner' });
  return AGENT_CONFIG_TOOL;
}

/** `GET /api/v1/projects/:id/agents/mcp-servers?branch=` */
export async function listMcpServers(
  options: EvalOptions,
  projectId: string,
  requestedBranch?: string,
): Promise<McpServerList> {
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, requestedBranch);
  const rows = await options.db
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.workspaceId, options.workspaceId),
        eq(mcpServers.projectId, project.id),
        eq(mcpServers.branch, branch),
      ),
    )
    .orderBy(asc(mcpServers.configPath), asc(mcpServers.name))
    .limit(500);
  return {
    projectId: project.id,
    branch,
    servers: rows.map((row) => ({
      name: row.name,
      configPath: row.configPath,
      transport: row.transport as McpServerList['servers'][number]['transport'],
      command: row.command,
      package: row.package,
      version: row.version,
      pinned: row.pinned,
      // Redacted again on the way out: a row stored before redaction must not publish it.
      url: row.url === null ? null : redactServerUrl(row.url),
      envKeys: row.envKeys,
      commitSha: row.commitSha,
      scannedAt: row.scannedAt.toISOString(),
    })),
  };
}
