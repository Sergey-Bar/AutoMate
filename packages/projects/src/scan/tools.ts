import type { RepoTool } from '@automate/shared-contracts';
import { objectField, readJson } from '../detect/manifest.js';
import { classifyScript, notRunnableReason } from './classify.js';

/**
 * Every command the repository declares, in every manifest it has.
 *
 * ## Through the package manager, never by re-parsing the script body
 *
 * `pnpm run lint` lets pnpm own quoting, env and pre/post hooks. Splitting the body of
 * `"lint": "eslint --max-warnings=0 src/"` here would be a second shell parser, and the
 * detector already refuses to be one for the same reason.
 *
 * ## Every workspace, not just the root
 *
 * The detector stops at the root manifest because it proposes *the* test command. A QA
 * lead asking "what can I run" wants `apps/web`'s `test` as well as the root's, and the
 * id carries the directory so the two are different tools.
 */
const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/** At most this many tools, so a monorepo of four hundred packages is still one response. */
const MAX_TOOLS = 600;

export async function scanTools(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<RepoTool[]> {
  const tools: RepoTool[] = [];
  for (const manifest of paths.filter(isPackageManifest)) {
    tools.push(...(await packageScripts(manifest, paths, read)));
  }
  if (paths.includes('Makefile')) tools.push(...makeTargets(await read('Makefile')));
  return tools.sort(byDirectoryThenName).slice(0, MAX_TOOLS);
}

function isPackageManifest(path: string): boolean {
  return path === 'package.json' || path.endsWith('/package.json');
}

async function packageScripts(
  manifest: string,
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<RepoTool[]> {
  const parsed = readJson(await read(manifest));
  if (parsed === null) return [];
  const scripts = objectField(parsed, 'scripts') ?? {};
  const directory = directoryOf(manifest);
  const manager = managerFor(directory, paths);
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, body]) => scriptTool({ name, body, directory, manager, manifest }));
}

function scriptTool(input: {
  name: string;
  body: string;
  directory: string;
  manager: string;
  manifest: string;
}): RepoTool {
  const argv = [input.manager, 'run', input.name];
  const reason = notRunnableReason(input.name, input.body);
  return {
    id: `script:${input.directory}:${input.name}`,
    name: input.name,
    label: argv.join(' '),
    kind: classifyScript(input.name, input.body),
    argv,
    workingDirectory: input.directory,
    source: input.manifest,
    evidence: input.body.length === 0 ? '(empty script)' : input.body,
    runnable: reason === null && input.body.length > 0,
    reason: input.body.length === 0 ? 'The script is empty.' : reason,
  };
}

/** `apps/web/package.json` → `apps/web`; `package.json` → `.`. */
function directoryOf(manifest: string): string {
  const slash = manifest.lastIndexOf('/');
  return slash === -1 ? '.' : manifest.slice(0, slash);
}

/**
 * The nearest lockfile at or above the manifest decides the manager.
 *
 * A workspace package has no lockfile of its own; the root's is the one its scripts are
 * installed against, so walking up is what makes `apps/web`'s scripts run under pnpm.
 */
function managerFor(directory: string, paths: readonly string[]): string {
  let current = directory;
  for (;;) {
    const prefix = current === '.' ? '' : `${current}/`;
    const found = LOCKFILES.find(([lockfile]) => paths.includes(`${prefix}${lockfile}`));
    if (found !== undefined) return found[1];
    if (current === '.') return 'npm';
    current = directoryOf(current);
  }
}

/** Explicit targets only: no pattern rules, no variables, no `.PHONY`. */
function makeTargets(text: string | null): RepoTool[] {
  if (text === null) return [];
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/u.exec(line);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names].map((name) => {
    const reason = notRunnableReason(name, '');
    return {
      id: `make:${name}`,
      name,
      label: `make ${name}`,
      kind: classifyScript(name, ''),
      argv: ['make', name],
      workingDirectory: '.',
      source: 'Makefile',
      evidence: `Makefile target ${name}`,
      runnable: reason === null,
      reason,
    };
  });
}

function byDirectoryThenName(left: RepoTool, right: RepoTool): number {
  if (left.workingDirectory !== right.workingDirectory) {
    // The root first: its scripts are the ones a team actually runs.
    if (left.workingDirectory === '.') return -1;
    if (right.workingDirectory === '.') return 1;
    return left.workingDirectory.localeCompare(right.workingDirectory);
  }
  return left.name.localeCompare(right.name);
}
