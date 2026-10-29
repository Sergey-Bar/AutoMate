/**
 * The read-only repository scanner and the detectors (R-001 to R-004).
 *
 * Rules, from docs/local/discovery-engine.md:
 *
 * - The scanner only opens files for reading. This module imports no function that writes,
 *   renames or deletes, and a test asserts that.
 * - Nothing is executed. Manifests are read and parsed, never evaluated.
 * - Every finding carries evidence. A detector that has none returns no finding.
 * - A limit that is hit, a file that cannot be read and a link that is not followed are
 *   recorded with a reason; they never abort the scan silently.
 */
import { lstat, open, opendir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { detectFormat } from './ingest.mjs';

/** Directories never entered. */
const NEVER = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
]);

/**
 * Build-output directories: entered only to reach a named report location beneath them.
 * A scan of `target` finds `target/surefire-reports` and nothing else.
 */
const BUILD_OUTPUT = new Set(['dist', 'build', 'target', 'out', '.next', '.gradle']);

/** Names that mark a place reports are written to. */
const REPORT_AREAS = new Set([
  'coverage',
  'reports',
  'test-results',
  'test-reports',
  'playwright-report',
  'surefire-reports',
  'failsafe-reports',
  'allure-results',
  'junit',
]);

/** Hidden directories worth entering. */
const HIDDEN_ALLOWED = new Set(['.github', '.gitlab', '.circleci']);

/** Scanner defaults. Every value is a proposal that needs measuring (see the quality document). */
export const DEFAULT_LIMITS = {
  maxDepth: 24,
  maxEntriesPerDirectory: 20_000,
  maxFiles: 500_000,
  maxManifestBytes: 1024 * 1024,
  maxTotalBytesRead: 256 * 1024 * 1024,
  sniffBytes: 4096,
};

const REPORT_EXTENSIONS = new Set(['.xml', '.json', '.info', '.lcov']);

/**
 * @typedef {{ detector: string, detectorVersion: string, subject: string,
 *   evidence: string[], confidence: number, limits: string[] }} Finding
 * @typedef {{ relativePath: string, ecosystem: string | null, packageManager: string | null,
 *   findings: Finding[], commands: Array<{ argv: string[], evidence: string, confidence: number }> }} Project
 * @typedef {{ relativePath: string, byteSize: number, modifiedMs: number,
 *   format: string | null, external: boolean }} ReportCandidate
 * @typedef {{ path: string, reason: string }} ScanNote
 */

/**
 * @param {string} relative
 * @returns {string}
 */
const posix = (relative) => relative.split(path.sep).join('/');

/**
 * Walks the repository.
 *
 * @param {string} root absolute path
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS>, signal?: AbortSignal,
 *   extraReportDirs?: string[], declaredFiles?: string[] }} [options]
 * declaredFiles are repository-relative report paths the caller expects (for example the
 * outputs of a run it started); each is checked to resolve inside the repository.
 */
export async function scanRepository(root, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const rootStat = await stat(root).catch(() => null);
  if (rootStat === null || !rootStat.isDirectory()) {
    return failed(root, 'not-a-directory');
  }
  const parsed = path.parse(path.resolve(root));
  if (parsed.root === path.resolve(root)) return failed(root, 'filesystem-root');
  // A folder that cannot be listed is refused here, with a reason, rather than scanned as
  // an empty folder: "nothing found" would be a claim about a folder nobody could read.
  const listable = await opendir(root).then(
    (handle) => handle.close().then(() => true),
    () => false,
  );
  if (!listable) return failed(root, 'unreadable');

  /** @type {Array<{ relativePath: string, size: number, modifiedMs: number }>} */
  const files = [];
  /** @type {ScanNote[]} */
  const notes = [];
  const hit = new Set();
  const visited = new Set();
  const rootReal = await realpath(root).catch(() => path.resolve(root));
  let cancelled = false;

  /**
   * @param {string} directory absolute
   * @param {string} relative
   * @param {number} depth
   * @param {{ restricted: boolean, reportArea: boolean }} mode
   */
  async function walk(directory, relative, depth, mode) {
    if (options.signal?.aborted === true) {
      cancelled = true;
      return;
    }
    if (depth > limits.maxDepth) {
      hit.add('maxDepth');
      return;
    }
    const real = await realpath(directory).catch(() => directory);
    // A junction or link that resolves outside the repository is never entered, even where
    // the operating system does not report it as a link.
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      notes.push({ path: relative || '.', reason: 'outside-repository' });
      return;
    }
    if (visited.has(real)) {
      notes.push({ path: relative || '.', reason: 'already-visited' });
      return;
    }
    visited.add(real);

    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      notes.push({
        path: relative || '.',
        reason: `unreadable:${/** @type {{ code?: string }} */ (error).code ?? 'error'}`,
      });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (entries.length > limits.maxEntriesPerDirectory) {
      hit.add('maxEntriesPerDirectory');
      entries = entries.slice(0, limits.maxEntriesPerDirectory);
    }
    for (const entry of entries) {
      if (options.signal?.aborted === true) {
        cancelled = true;
        return;
      }
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const childPath = path.join(directory, entry.name);
      let info;
      try {
        info = await lstat(childPath);
      } catch (error) {
        notes.push({
          path: childRelative,
          reason: `unreadable:${/** @type {{ code?: string }} */ (error).code ?? 'error'}`,
        });
        continue;
      }
      if (info.isSymbolicLink()) {
        notes.push({ path: childRelative, reason: 'link-not-followed' });
        continue;
      }
      if (info.isDirectory()) {
        const child = enterMode(entry.name, mode);
        if (child !== null) await walk(childPath, childRelative, depth + 1, child);
        else notes.push({ path: childRelative, reason: 'ignored' });
        continue;
      }
      if (!info.isFile()) continue;
      if (mode.restricted) continue;
      if (files.length >= limits.maxFiles) {
        hit.add('maxFiles');
        return;
      }
      files.push({ relativePath: childRelative, size: info.size, modifiedMs: info.mtimeMs });
    }
  }

  await walk(path.resolve(root), '', 0, { restricted: false, reportArea: false });

  const view = fileView(path.resolve(root), files, limits);
  const projects = await detectProjects(view);
  const reports = await discoverReports(path.resolve(root), files, limits);
  for (const dir of options.extraReportDirs ?? []) {
    reports.push(...(await externalReports(path.resolve(dir), limits)));
  }
  for (const declared of await declaredReports(
    path.resolve(root),
    options.declaredFiles ?? [],
    limits,
  )) {
    if (!reports.some((report) => report.relativePath === declared.relativePath))
      reports.push(declared);
  }

  const status = cancelled ? 'cancelled' : hit.size > 0 ? 'partial' : 'complete';
  return {
    status,
    root: path.resolve(root),
    limitsHit: [...hit].sort(),
    filesSeen: files.length,
    bytesRead: view.bytesRead(),
    projects,
    reports,
    notes,
  };
}

/**
 * @param {string} root
 * @param {string} reason
 */
function failed(root, reason) {
  return {
    status: /** @type {const} */ ('failed'),
    root,
    reason,
    limitsHit: [],
    filesSeen: 0,
    bytesRead: 0,
    projects: [],
    reports: [],
    notes: [],
  };
}

/**
 * Decides whether, and how, to enter a directory.
 *
 * @param {string} name
 * @param {{ restricted: boolean, reportArea: boolean }} mode
 * @returns {{ restricted: boolean, reportArea: boolean } | null}
 */
function enterMode(name, mode) {
  if (NEVER.has(name)) return null;
  if (REPORT_AREAS.has(name)) return { restricted: false, reportArea: true };
  // Inside build output only a named report location is entered, and that was handled above.
  if (mode.restricted) return null;
  if (BUILD_OUTPUT.has(name)) return { restricted: true, reportArea: false };
  if (name.startsWith('.') && !HIDDEN_ALLOWED.has(name)) return null;
  return { restricted: false, reportArea: mode.reportArea };
}

/**
 * A bounded read-only view over the files the walk found.
 *
 * @param {string} root
 * @param {Array<{ relativePath: string, size: number }>} files
 * @param {typeof DEFAULT_LIMITS} limits
 */
function fileView(root, files, limits) {
  let total = 0;
  const paths = files.map((file) => file.relativePath);
  return {
    paths: () => paths,
    bytesRead: () => total,
    /**
     * @param {string} relativePath
     * @returns {Promise<{ kind: 'text', text: string, truncated: boolean } | { kind: 'absent' } | { kind: 'refused', reason: string }>}
     */
    async read(relativePath) {
      const file = files.find((candidate) => candidate.relativePath === relativePath);
      if (file === undefined) return { kind: 'absent' };
      if (file.size > limits.maxManifestBytes) return { kind: 'refused', reason: 'too-large' };
      if (total + file.size > limits.maxTotalBytesRead)
        return { kind: 'refused', reason: 'read-budget' };
      try {
        const buffer = await readFile(path.join(root, relativePath));
        total += buffer.byteLength;
        if (buffer.includes(0)) return { kind: 'refused', reason: 'binary' };
        return { kind: 'text', text: buffer.toString('utf8'), truncated: false };
      } catch {
        return { kind: 'refused', reason: 'unreadable' };
      }
    },
  };
}

// ── Detectors ───────────────────────────────────────────────────────────────────────────

const DETECTOR_VERSION = '1';

/**
 * The first line containing a needle, as `path:line text`, or null.
 *
 * @param {string} file
 * @param {string} text
 * @param {RegExp | string} needle
 * @returns {string | null}
 */
export function evidenceFor(file, text, needle) {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (typeof needle === 'string' ? line.includes(needle) : needle.test(line)) {
      return `${file}:${String(index + 1)} ${line.trim().slice(0, 120)}`;
    }
  }
  return null;
}

/**
 * @param {string} subject
 * @param {string[]} evidence
 * @param {number} confidence
 * @param {string} detector
 * @param {string[]} [limits]
 * @returns {Finding | null}
 */
function finding(subject, evidence, confidence, detector, limits = []) {
  const kept = evidence.filter(Boolean);
  if (kept.length === 0) return null;
  return {
    detector,
    detectorVersion: DETECTOR_VERSION,
    subject,
    evidence: kept,
    confidence,
    limits,
  };
}

const dirOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const joinRel = (dir, name) => (dir === '' ? name : `${dir}/${name}`);

/**
 * @param {ReturnType<typeof fileView>} view
 * @returns {Promise<Project[]>}
 */
export async function detectProjects(view) {
  const paths = view.paths();
  /** @type {Map<string, Project>} */
  const projects = new Map();
  /** @param {string} dir */
  const project = (dir) => {
    let found = projects.get(dir);
    if (found === undefined) {
      found = {
        relativePath: dir === '' ? '.' : dir,
        ecosystem: null,
        packageManager: null,
        findings: [],
        commands: [],
      };
      projects.set(dir, found);
    }
    return found;
  };

  for (const file of paths) {
    const name = file.split('/').at(-1) ?? '';
    const dir = dirOf(file);
    if (name === 'package.json') await detectNode(view, project(dir), dir, file, paths);
    else if (name === 'pyproject.toml' || name === 'pytest.ini' || name === 'tox.ini') {
      await detectPython(view, project(dir), file);
    } else if (name === 'pom.xml') await detectMaven(view, project(dir), file);
    else if (name === 'build.gradle' || name === 'build.gradle.kts')
      await detectGradle(view, project(dir), dir, file, paths);
    else if (name.endsWith('.csproj')) await detectDotnet(view, project(dir), file);
    else if (name === 'go.mod') await detectGo(view, project(dir), dir, file, paths);
  }
  for (const file of paths) {
    if (
      /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file) ||
      file === '.gitlab-ci.yml' ||
      file === '.circleci/config.yml'
    ) {
      const result = finding('ci-configuration', [`${file}:1`], 0.9, 'ci');
      if (result !== null) project('').findings.push(result);
    }
  }
  return [...projects.values()]
    .filter((p) => p.findings.length > 0 || p.ecosystem !== null)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

const NODE_TOOLS = [
  ['vitest', 'vitest'],
  ['jest', 'jest'],
  ['mocha', 'mocha'],
  ['ava', 'ava'],
  ['@playwright/test', 'playwright'],
  ['cypress', 'cypress'],
];

/**
 * Test-tool plugins recorded as facts, so a recommendation can tell that one is already
 * there. A dependency name and the subject it is recorded under.
 *
 * @type {Array<[string, string]>}
 */
const NODE_PLUGINS = [
  ['@vitest/coverage-v8', 'vitest-coverage-v8'],
  ['@vitest/coverage-istanbul', 'vitest-coverage-istanbul'],
  ['jest-junit', 'jest-junit'],
];

/** @type {Array<[string, string]>} */
const NODE_LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

async function detectNode(view, project, dir, file, paths) {
  const read = await view.read(file);
  if (read.kind !== 'text') {
    project.findings.push(
      ...[
        finding(
          'unreadable-manifest',
          [`${file}:1 ${read.kind === 'refused' ? read.reason : 'absent'}`],
          0.1,
          'node',
          [read.kind === 'refused' ? read.reason : 'absent'],
        ),
      ].filter(Boolean),
    );
    return;
  }
  /** @type {{ scripts?: Record<string, string>, dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} */
  let manifest;
  try {
    manifest = JSON.parse(read.text);
  } catch {
    const bad = finding('unparseable-manifest', [`${file}:1`], 0.1, 'node', ['invalid-json']);
    if (bad !== null) project.findings.push(bad);
    return;
  }
  project.ecosystem = 'node';
  for (const [lock, manager] of NODE_LOCKFILES) {
    if (paths.includes(joinRel(dir, lock))) {
      project.packageManager = manager;
      const f = finding(`package-manager:${manager}`, [`${joinRel(dir, lock)}:1`], 0.9, 'node');
      if (f !== null) project.findings.push(f);
      break;
    }
  }
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [dependency, tool] of NODE_TOOLS) {
    if (!(dependency in deps)) continue;
    const configPattern = new RegExp(
      `^${tool === 'playwright' ? 'playwright' : tool}\\.config\\.[cm]?[jt]s$`,
    );
    const config = paths.find(
      (p) => dirOf(p) === dir && configPattern.test(p.split('/').at(-1) ?? ''),
    );
    const f = finding(
      `test-tool:${tool}`,
      [
        evidenceFor(file, read.text, `"${dependency}"`) ?? '',
        config === undefined ? '' : `${config}:1`,
      ],
      config === undefined ? 0.6 : 0.95,
      'node',
      config === undefined ? ['no configuration file found'] : [],
    );
    if (f !== null) project.findings.push(f);
  }
  const testScript = manifest.scripts?.test;
  for (const [dependency, subject] of NODE_PLUGINS) {
    if (!(dependency in deps)) continue;
    const f = finding(
      `plugin:${subject}`,
      [evidenceFor(file, read.text, `"${dependency}"`) ?? ''],
      0.9,
      'node',
    );
    if (f !== null) project.findings.push(f);
  }
  if (typeof testScript === 'string' && !/no test specified/.test(testScript)) {
    const manager = project.packageManager ?? 'npm';
    const evidence = evidenceFor(file, read.text, '"test"') ?? `${file}:1`;
    project.commands.push({ argv: [manager, 'run', 'test'], evidence, confidence: 0.8 });
    if (/node\s+--test/.test(testScript)) {
      const f = finding('test-tool:node-test-runner', [evidence], 0.8, 'node');
      if (f !== null) project.findings.push(f);
    }
  }
}

async function detectPython(view, project, file) {
  const read = await view.read(file);
  if (read.kind !== 'text') return;
  const evidence = evidenceFor(file, read.text, /pytest/i);
  if (evidence === null && !file.endsWith('pytest.ini')) return;
  project.ecosystem = 'python';
  const f = finding(
    'test-tool:pytest',
    [evidence ?? `${file}:1`],
    file.endsWith('pytest.ini') ? 0.95 : 0.7,
    'python',
  );
  if (f !== null) project.findings.push(f);
  project.commands.push({
    argv: ['python', '-m', 'pytest'],
    evidence: evidence ?? `${file}:1`,
    confidence: 0.7,
  });
  const cov = evidenceFor(file, read.text, /pytest-cov/i);
  if (cov !== null) {
    const plugin = finding('plugin:pytest-cov', [cov], 0.9, 'python');
    if (plugin !== null) project.findings.push(plugin);
  }
}

async function detectMaven(view, project, file) {
  const read = await view.read(file);
  if (read.kind !== 'text') return;
  project.ecosystem = 'java';
  project.packageManager = 'maven';
  const evidence = evidenceFor(file, read.text, /surefire|junit/i);
  const f = finding('test-tool:junit', [evidence ?? ''], 0.8, 'java');
  if (f !== null) project.findings.push(f);
  project.commands.push({ argv: ['mvn', 'test'], evidence: `${file}:1`, confidence: 0.75 });
}

async function detectGradle(view, project, dir, file, paths) {
  const read = await view.read(file);
  if (read.kind !== 'text') return;
  project.ecosystem = 'java';
  project.packageManager = 'gradle';
  const evidence = evidenceFor(file, read.text, /junit|useJUnitPlatform|testng/i);
  const f = finding('test-tool:junit', [evidence ?? ''], 0.8, 'java');
  if (f !== null) project.findings.push(f);
  const wrapper = paths.includes(joinRel(dir, 'gradlew'))
    ? ['./gradlew', 'test']
    : ['gradle', 'test'];
  project.commands.push({ argv: wrapper, evidence: `${file}:1`, confidence: 0.75 });
}

async function detectDotnet(view, project, file) {
  const read = await view.read(file);
  if (read.kind !== 'text') return;
  const evidence = evidenceFor(file, read.text, /Microsoft\.NET\.Test\.Sdk|xunit|nunit|MSTest/i);
  if (evidence === null) return;
  project.ecosystem = 'dotnet';
  const f = finding('test-tool:dotnet-test', [evidence], 0.85, 'dotnet');
  if (f !== null) project.findings.push(f);
  project.commands.push({ argv: ['dotnet', 'test'], evidence, confidence: 0.8 });
}

async function detectGo(view, project, dir, file, paths) {
  const read = await view.read(file);
  if (read.kind !== 'text') return;
  const tests = paths.find(
    (p) => p.endsWith('_test.go') && p.startsWith(dir === '' ? '' : `${dir}/`),
  );
  if (tests === undefined) return;
  project.ecosystem = 'go';
  const f = finding('test-tool:go-test', [`${file}:1`, `${tests}:1`], 0.9, 'go');
  if (f !== null) project.findings.push(f);
  project.commands.push({
    argv: ['go', 'test', './...'],
    evidence: `${tests}:1`,
    confidence: 0.85,
  });
}

// ── Report discovery ────────────────────────────────────────────────────────────────────

/**
 * Coverage files written beside lcov in formats this product does not read (Istanbul's
 * JSON). Matched by name inside report areas, they were sniffed as broken Playwright
 * reports and every Jest or Vitest project showed two incomplete reports.
 */
const NOT_REPORTS = new Set(['coverage-summary.json', 'coverage-final.json']);

/**
 * Whether a path looks like it could be a report worth sniffing.
 *
 * @param {string} relativePath
 */
export function isReportShaped(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (!REPORT_EXTENSIONS.has(ext)) return false;
  const segments = relativePath.split('/');
  if (NOT_REPORTS.has(segments.at(-1) ?? '')) return false;
  if (segments.some((segment) => REPORT_AREAS.has(segment))) return true;
  return /(junit|test-?results?|report|lcov|coverage|cobertura|results)/i.test(
    segments.at(-1) ?? '',
  );
}

/**
 * @param {string} absolute
 * @param {number} bytes
 * @returns {Promise<Uint8Array>}
 */
async function head(absolute, bytes) {
  const handle = await open(absolute, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * @param {Uint8Array} sample
 * @returns {string | null}
 */
function sniff(sample) {
  const format = detectFormat(sample);
  const text = Buffer.from(sample).toString('utf8');
  if (format === 'cobertura-xml') return 'cobertura-xml';
  if (format === 'junit-xml') return /<testsuites?\b/.test(text) ? 'junit-xml' : null;
  if (format === 'playwright-json') return /"suites"/.test(text) ? 'playwright-json' : null;
  if (format === 'lcov') return 'lcov';
  return null;
}

/**
 * The format of a file from its first bytes, or null when it cannot be read.
 *
 * @param {string} absolute
 * @param {number} bytes
 * @returns {Promise<string | null>}
 */
async function sniffFile(absolute, bytes) {
  try {
    return sniff(await head(absolute, bytes));
  } catch {
    return null;
  }
}

async function discoverReports(root, files, limits) {
  /** @type {ReportCandidate[]} */
  const found = [];
  for (const file of files) {
    if (!isReportShaped(file.relativePath)) continue;
    const format = await sniffFile(path.join(root, file.relativePath), limits.sniffBytes);
    found.push({
      relativePath: file.relativePath,
      byteSize: file.size,
      modifiedMs: file.modifiedMs,
      format,
      external: false,
    });
  }
  return found;
}

/**
 * Reports in a directory the user named. A directory outside the repository is allowed only
 * because the user asked for it, and its reports are marked external.
 *
 * @param {string} directory
 * @param {typeof DEFAULT_LIMITS} limits
 */
async function externalReports(directory, limits) {
  /** @type {ReportCandidate[]} */
  const found = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !REPORT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const absolute = path.join(directory, entry.name);
    const info = await lstat(absolute);
    const format = await sniffFile(absolute, limits.sniffBytes);
    found.push({
      relativePath: posix(absolute),
      byteSize: info.size,
      modifiedMs: info.mtimeMs,
      format,
      external: true,
    });
  }
  return found;
}

/**
 * Resolves a path the caller named to an absolute path that is certainly inside `root`.
 * Returns null for an absolute path, one that climbs out with `..`, one through a link
 * that leads outside, or one that does not exist. Containment is decided on the resolved
 * path, because a lexical check is defeated by a junction.
 *
 * @param {string} root
 * @param {string} relative
 * @returns {Promise<string | null>}
 */
export async function resolveInside(root, relative) {
  if (relative === '' || relative.includes('\0')) return null;
  const posixed = relative.replaceAll('\\', '/');
  if (posixed.startsWith('/') || /^[A-Za-z]:/.test(posixed)) return null;
  if (posixed.split('/').includes('..')) return null;
  const rootReal = await realpath(root).catch(() => null);
  if (rootReal === null) return null;
  const real = await realpath(path.join(root, ...posixed.split('/'))).catch(() => null);
  if (real === null) return null;
  const rel = path.relative(rootReal, real);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return real;
}

/**
 * @param {string} root
 * @param {string[]} declared
 * @param {typeof DEFAULT_LIMITS} limits
 */
async function declaredReports(root, declared, limits) {
  /** @type {ReportCandidate[]} */
  const found = [];
  for (const relative of declared) {
    const real = await resolveInside(root, relative);
    if (real === null) continue;
    const info = await stat(real).catch(() => null);
    if (info === null || !info.isFile()) continue;
    const format = await sniffFile(real, limits.sniffBytes);
    found.push({
      relativePath: relative.replaceAll('\\', '/'),
      byteSize: info.size,
      modifiedMs: info.mtimeMs,
      format,
      external: false,
    });
  }
  return found;
}
