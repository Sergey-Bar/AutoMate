import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * The agent instruction and MCP configuration files a repository carries, collected for
 * `POST /health/agent-config`.
 *
 * **One list, held twice on purpose, and tested to agree.** The CLI ships with no dependency,
 * so it cannot import `AGENT_CONFIG_PATHS` from `@automate/projects`; `units.test.ts`
 * fails if the two lists, or the two size limits, ever differ. The server applies its own
 * list again and reports what it ignored, so a disagreement could only send a file the
 * server then drops — never scan one it would not.
 */
export const AGENT_CONFIG_PATHS: readonly string[] = Object.freeze([
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
  '**/GEMINI.md',
  '.claude/agents/*.md',
  '.claude/commands/*.md',
  '.cursorrules',
  '.cursor/rules/**/*.mdc',
  '.github/copilot-instructions.md',
  '.github/instructions/**/*.instructions.md',
  '.github/prompts/*.prompt.md',
  '.windsurfrules',
  '.windsurf/rules/*.md',
  '.kiro/steering/*.md',
  '.kilo/agent/*.md',
  '**/SKILL.md',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  '.kiro/settings/mcp.json',
  '.gemini/settings.json',
  '**/claude_desktop_config.json',
]);

export const MAX_AGENT_CONFIG_FILES = 200;
export const MAX_AGENT_CONFIG_FILE_BYTES = 256 * 1024;

/** Directories never walked: dependencies, build output and VCS metadata are not the repository's. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next']);
const MAX_DEPTH = 12;

function compile(pattern: string): RegExp {
  let source = '';
  for (const segment of pattern.toLowerCase().split('/')) {
    if (segment === '**') {
      source += '(?:[^/]+/)*';
      continue;
    }
    const escaped = segment
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
      .join('[^/]*');
    source += `${escaped}/`;
  }
  return new RegExp(`^${source.slice(0, -1)}$`, 'u');
}

const MATCHERS = AGENT_CONFIG_PATHS.map(compile);

/** Whether a repository-relative path is one the agent-config scan reads. Case-insensitive. */
export function isAgentConfigPath(relative: string): boolean {
  const normal = relative
    .replace(/\\/gu, '/')
    .replace(/^(?:\.\/)+/u, '')
    .toLowerCase();
  return MATCHERS.some((matcher) => matcher.test(normal));
}

export interface CollectedFiles {
  files: Array<{ path: string; text: string }>;
  /** Paths that matched and were not sent: over the size limit, or past the file limit. */
  skipped: string[];
}

async function walk(root: string, relative: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) await walk(root, child, depth + 1, found);
    } else if (entry.isFile() && isAgentConfigPath(child)) {
      found.push(child);
    }
  }
}

/** Every matching file under `root`, in path order, within the server's limits. */
export async function collectAgentConfig(root: string): Promise<CollectedFiles> {
  const found: string[] = [];
  await walk(root, '', 0, found);
  const files: CollectedFiles['files'] = [];
  const skipped: string[] = [];
  for (const relative of found) {
    const size = (await stat(path.join(root, relative))).size;
    if (size > MAX_AGENT_CONFIG_FILE_BYTES || files.length >= MAX_AGENT_CONFIG_FILES) {
      skipped.push(relative);
      continue;
    }
    files.push({ path: relative, text: await readFile(path.join(root, relative), 'utf8') });
  }
  return { files, skipped };
}
