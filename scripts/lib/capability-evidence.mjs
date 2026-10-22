import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The evidence behind a capability register row.
 *
 * `scripts/capability-register.mjs` checks that the paths a row cites exist. That is
 * a claim about files, and a file exists whether or not the capability works: a row
 * kept asserting `real` after the test that justified it was deleted, because a
 * sibling test file satisfied the path check. A status typed by a human and read by
 * no tool is true on the day it was written.
 *
 * This module derives, for every row, one of two verdicts:
 *
 *  - `verified`   - the row names a command that resolves, every file it cites exists,
 *                   every test file it cites is collected by a test runner, and a row
 *                   asserting `real` rests on a test or on a root gate script;
 *  - `unverified` - any of those is false. The row is not necessarily wrong; its
 *                   claim is no longer backed by anything that could fail.
 *
 * **What the static pass decides, and what it does not.** It decides that the
 * evidence is *there and wired*: deleting a test, renaming a script, dropping a
 * package from the workspace, or narrowing a vitest `include` flips the row. It does
 * not decide that the command *passes*. That is `runCommands`, behind `--run`,
 * because running forty commands is minutes of work and a check that costs that much
 * is a check nobody runs on a pull request.
 *
 * It also cannot decide that the prose is true. Whether a row says `missing` about
 * something that exists is a reading of the code against the sentence, and a script
 * that guessed would be worse than none (ledger REG-1 records four such rows, and the
 * paths they cited all existed).
 */

/** The register's evidence rule: a citation is a path, or something a person can follow. */
const EXTERNAL_CITATION = /^(https?:|docs\/migration\/[^/]+\.json|AutoMate\/)/;

/** Directories a qualification may cite a path inside. */
const REPO_TOP_LEVEL = new Set([
  'apps',
  'packages',
  'tools',
  'tests',
  'scripts',
  'docs',
  'infra',
  'site',
  '.github',
  '.kilo',
  '.config',
]);

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * @typedef {'verified' | 'unverified'} Verdict
 * @typedef {{ id: string, status: string, commands: string[], verdict: Verdict, reasons: string[] }} RowReport
 * @typedef {{ rows: RowReport[] }} Report
 * @typedef {{ name: string, dir: string, scripts: Record<string, string> }} WorkspacePackage
 */

/**
 * Backticked spans in a cell.
 *
 * @param {string} cell
 * @returns {string[]}
 */
function backticked(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => (match[1] ?? '').trim());
}

/**
 * One `|`-delimited cell at a time, as `capability-register.mjs` does, so a row's
 * cells are collected in a linear pass with no nested quantifier.
 *
 * @param {string} line
 * @returns {string[] | undefined}
 */
function cellsOf(line) {
  if (!line.trimStart().startsWith('|')) return undefined;
  const parts = line.trim().split('|');
  // A leading and a trailing empty part come from the outer pipes.
  return parts.slice(1, parts.at(-1) === '' ? -1 : undefined).map((cell) => cell.trim());
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isCapabilityId(value) {
  if (value === '') return false;
  return value
    .split('.')
    .every((segment) => segment !== '' && /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

/**
 * The register's rows, with the columns located by header name so a reordered or
 * widened table is read correctly instead of silently shifted.
 *
 * @param {string} text
 */
export function parseRegister(text) {
  /** @type {Record<string, number> | undefined} */
  let columns;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = cellsOf(line);
    if (cells === undefined) continue;
    if ((cells[0] ?? '').toLowerCase() === 'id') {
      columns = Object.fromEntries(cells.map((name, index) => [name.toLowerCase(), index]));
      continue;
    }
    const id = cells[0] ?? '';
    if (columns === undefined || !isCapabilityId(id)) continue;
    const at = (/** @type {string} */ name) => {
      const index = columns?.[name];
      return index === undefined ? undefined : (cells[index] ?? '');
    };
    rows.push({
      id,
      status: at('status') ?? '',
      qualification: at('qualification') ?? '',
      evidence: at('evidence') ?? '',
      command: at('command'),
      cellCount: cells.length,
      headerCount: Object.keys(columns).length,
    });
  }
  return rows;
}

/**
 * Translates a glob to a RegExp, character by character. Supports `**`, `*`, `?`,
 * `{a,b}` and `[...]`, which is every construct the repository's test globs use.
 * There is no quantifier over a group, so it cannot backtrack catastrophically.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? '';
    if (char === '*') {
      const star = starToken(glob, i);
      out += star.pattern;
      i += star.consumed;
    } else if (char === '{') {
      braceDepth += 1;
      out += '(?:';
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
      out += ')';
    } else {
      out += plainToken(char, braceDepth > 0);
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * The pattern for a `*` at `at`, and how many further characters it consumed.
 *
 * @param {string} glob
 * @param {number} at
 * @returns {{ pattern: string, consumed: number }}
 */
function starToken(glob, at) {
  if (glob[at + 1] !== '*') return { pattern: '[^/]*', consumed: 0 };
  return glob[at + 2] === '/'
    ? { pattern: '(?:.*/)?', consumed: 2 }
    : { pattern: '.*', consumed: 1 };
}

/**
 * The pattern for any character that is not `*` or a brace.
 *
 * @param {string} char
 * @param {boolean} inBraces
 * @returns {string}
 */
function plainToken(char, inBraces) {
  if (char === '?') return '[^/]';
  if (char === ',' && inBraces) return '|';
  if (char === '[' || char === ']') return char;
  return char.replace(/[.+^$()|\\]/g, '\\$&');
}

/**
 * Workspace packages, from `pnpm-workspace.yaml` globs of the shape `dir` or `dir/*`.
 *
 * @param {string} root
 * @returns {Map<string, WorkspacePackage>}
 */
function readWorkspacePackages(root) {
  /** @type {Map<string, WorkspacePackage>} */
  const packages = new Map();
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) return packages;
  const globs = [...readFileSync(workspaceFile, 'utf8').matchAll(/^\s*-\s*['"]?([^'"#\s]+)['"]?/gm)]
    .map((match) => match[1] ?? '')
    .filter((glob) => !glob.startsWith('!'));
  for (const glob of globs) {
    const dirs = glob.endsWith('/*')
      ? subdirectories(path.join(root, glob.slice(0, -2)))
      : [path.join(root, glob)];
    for (const dir of dirs) {
      const manifest = readJson(path.join(dir, 'package.json'));
      if (manifest === undefined || typeof manifest['name'] !== 'string') continue;
      const scripts = manifest['scripts'];
      packages.set(manifest['name'], {
        name: manifest['name'],
        dir,
        scripts: isStringRecord(scripts) ? scripts : {},
      });
    }
  }
  return packages;
}

/** @param {string} dir @returns {string[]} */
function subdirectories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => path.join(dir, entry.name));
}

/** @param {string} file @returns {Record<string, unknown> | undefined} */
function readJson(file) {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(file, 'utf8')));
    return typeof parsed === 'object' && parsed !== null
      ? /** @type {Record<string, unknown>} */ (parsed)
      : undefined;
  } catch {
    return undefined;
  }
}

/** @param {unknown} value @returns {value is Record<string, string>} */
function isStringRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/**
 * The string literals in `key: [ ... ]` of a vitest config, or `undefined` when the
 * key is absent. A config that builds the list from an expression is read as absent,
 * which falls back to the default - the safe direction is the one that then fails to
 * collect an unusual test, never one that collects it on a guess.
 *
 * @param {string} config
 * @param {'include' | 'exclude'} key
 * @returns {string[] | undefined}
 */
function configList(config, key) {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(config);
  if (match === null) return undefined;
  return [...(match[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1] ?? '');
}

/**
 * @param {string} dir
 * @returns {string}
 */
function readVitestConfig(dir) {
  for (const name of [
    'vitest.config.ts',
    'vitest.config.mts',
    'vitest.config.js',
    'vitest.config.mjs',
  ]) {
    const file = path.join(dir, name);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  return '';
}

/**
 * Whether `relative` (a path inside a vitest package) matches an `exclude` entry.
 * A bare name such as `node_modules` excludes any path segment of that name.
 *
 * @param {string} relative
 * @param {string} pattern
 */
function excludedBy(relative, pattern) {
  if (!/[*?{[]/.test(pattern)) {
    return relative.split('/').includes(pattern) || relative === pattern;
  }
  return globToRegExp(pattern).test(relative);
}

/**
 * The context a row is judged in: the root's scripts, the workspace, and the test
 * globs that name files for a runner.
 *
 * @param {string} root
 */
function loadTree(root) {
  const manifest = readJson(path.join(root, 'package.json'));
  const scripts = isStringRecord(manifest?.['scripts']) ? manifest['scripts'] : {};
  return { root, rootScripts: scripts, packages: readWorkspacePackages(root) };
}

/** @typedef {ReturnType<typeof loadTree>} Tree */

/**
 * Whether some runner would pick this test file up.
 *
 *  1. A vitest package: the nearest `package.json` runs `vitest`, the file matches the
 *     config's `include` (or the default test-file pattern) and no `exclude` entry.
 *  2. A `node --test` file: some script, in the owning package or at the root, names a
 *     glob that matches it.
 *
 * @param {Tree} tree
 * @param {string} file repository-relative, forward slashes
 * @returns {boolean}
 */
function isCollected(tree, file) {
  const owner = [...tree.packages.values()]
    .filter((pkg) => isInside(tree.root, pkg.dir, file))
    .sort((a, b) => b.dir.length - a.dir.length)[0];

  if (owner !== undefined && /\bvitest\b/.test(owner.scripts['test'] ?? '')) {
    const relative = path.relative(owner.dir, path.join(tree.root, file)).split(path.sep).join('/');
    const config = readVitestConfig(owner.dir);
    const include = configList(config, 'include');
    const exclude = configList(config, 'exclude') ?? [];
    const included =
      include === undefined
        ? TEST_FILE.test(relative)
        : include.some((glob) => globToRegExp(glob).test(relative));
    if (included && !exclude.some((pattern) => excludedBy(relative, pattern))) return true;
  }

  const commands = [
    ...Object.values(tree.rootScripts),
    ...(owner === undefined ? [] : Object.values(owner.scripts)),
  ];
  return commands.some((command) =>
    nodeTestGlobs(command).some((glob) => matchesFromRoot(tree, owner, glob, file)),
  );
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {string} file
 */
function isInside(root, dir, file) {
  const relative = path.relative(dir, path.join(root, file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The file arguments of `node --test` commands: tokens that look like a test glob.
 *
 * @param {string} command
 * @returns {string[]}
 */
function nodeTestGlobs(command) {
  if (!/\bnode\b[^&|;]*--test\b/.test(command)) return [];
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, '').replace(/^\.\//, ''))
    .filter((token) => TEST_FILE.test(token) || /\*\.test\.[cm]?[jt]s/.test(token));
}

/**
 * @param {Tree} tree
 * @param {WorkspacePackage | undefined} owner
 * @param {string} glob
 * @param {string} file
 */
function matchesFromRoot(tree, owner, glob, file) {
  if (globToRegExp(glob).test(file)) return true;
  if (owner === undefined) return false;
  const relative = path.relative(owner.dir, path.join(tree.root, file)).split(path.sep).join('/');
  return globToRegExp(glob).test(relative);
}

/**
 * Judges one parsed `pnpm ...` command. Accepted shapes:
 *
 *   pnpm <root-script> [args]
 *   pnpm --filter <package> <script> [args]
 *   pnpm --filter <package> exec vitest run <file>...
 *   pnpm exec node --test <file>...
 *
 * @param {Tree} tree
 * @param {string} command
 * @param {string[]} reasons
 */
function checkCommand(tree, command, reasons) {
  const argv = command.split(/\s+/).filter(Boolean);
  if (argv[0] !== 'pnpm') {
    reasons.push(`command \`${command}\` is not a pnpm command, so it cannot be resolved`);
    return;
  }
  const rest = argv.slice(1);
  if (rest[0] === '--filter' || rest[0] === '-F') {
    checkFilterCommand(tree, command, rest, reasons);
  } else if (rest[0] === 'exec') {
    checkExecCommand(tree, command, rest, reasons);
  } else {
    const script = rest[0] === 'run' ? (rest[1] ?? '') : (rest[0] ?? '');
    if (tree.rootScripts[script] === undefined) {
      reasons.push(`command \`${command}\`: \`${script}\` is not a root script`);
    }
  }
}

/**
 * `pnpm --filter <package> <script>` and `pnpm --filter <package> exec vitest run <file>...`.
 *
 * @param {Tree} tree
 * @param {string} command
 * @param {string[]} rest the words after `pnpm`
 * @param {string[]} reasons
 */
function checkFilterCommand(tree, command, rest, reasons) {
  const name = rest[1] ?? '';
  const pkg = tree.packages.get(name);
  if (pkg === undefined) {
    reasons.push(`command \`${command}\`: ${name} is no workspace package`);
    return;
  }
  const verb = rest[2] ?? '';
  if (verb !== 'exec') {
    if (pkg.scripts[verb] === undefined) {
      reasons.push(`command \`${command}\`: ${name} has no \`${verb}\` script`);
    }
    return;
  }
  if (rest[3] !== 'vitest' || rest[4] !== 'run') {
    reasons.push(`command \`${command}\`: only \`exec vitest run <file>\` can be resolved`);
    return;
  }
  for (const arg of rest.slice(5).filter((token) => !token.startsWith('-'))) {
    const absolute = path.join(pkg.dir, arg);
    checkTarget(
      tree,
      command,
      path.relative(tree.root, absolute).split(path.sep).join('/'),
      reasons,
    );
  }
}

/**
 * `pnpm exec node --test <file>...` - the shape for a node:test gate script.
 *
 * @param {Tree} tree
 * @param {string} command
 * @param {string[]} rest the words after `pnpm`
 * @param {string[]} reasons
 */
function checkExecCommand(tree, command, rest, reasons) {
  if (rest[1] !== 'node' || rest[2] !== '--test') {
    reasons.push(`command \`${command}\`: only \`exec node --test <file>\` can be resolved`);
    return;
  }
  for (const arg of rest.slice(3).filter((token) => !token.startsWith('-'))) {
    checkTarget(tree, command, arg, reasons);
  }
}

/**
 * A test file a command names must exist and be collected by some runner.
 *
 * @param {Tree} tree
 * @param {string} command
 * @param {string} relative repository-relative, forward slashes
 * @param {string[]} reasons
 */
function checkTarget(tree, command, relative, reasons) {
  if (!existsSync(path.join(tree.root, relative))) {
    reasons.push(`command \`${command}\` targets ${relative}, which does not exist`);
  } else if (!isCollected(tree, relative)) {
    reasons.push(`command \`${command}\` targets ${relative}, which no test config collects`);
  }
}

/**
 * @param {string} citation
 * @returns {boolean}
 */
function isCheckablePath(citation) {
  return !EXTERNAL_CITATION.test(citation) && !citation.includes('*');
}

/**
 * Paths cited in a qualification: backticked, slash-bearing, rooted in a top-level
 * directory this repository has, and without prose punctuation around them. A
 * `path:123` or `path#anchor` reference is judged on the path.
 *
 * @param {string} qualification
 * @param {string} root
 * @returns {string[]}
 */
function qualificationPaths(qualification, root) {
  return backticked(qualification)
    .map((span) => span.replace(/[:#]\S*$/, ''))
    .filter(
      (span) =>
        /^[\w.@/-]+$/.test(span) &&
        span.includes('/') &&
        !span.startsWith('/') &&
        (REPO_TOP_LEVEL.has(span.split('/')[0] ?? '') ||
          existsSync(path.join(root, span.split('/')[0] ?? ''))) &&
        isCheckablePath(span),
    );
}

/**
 * Judges every row of a register against a tree.
 *
 * @param {{ root: string, registerText: string }} input
 * @returns {Report}
 */
export function evaluateRegister({ root, registerText }) {
  const tree = loadTree(root);
  const rows = parseRegister(registerText).map((row) => {
    const evidence = backticked(row.evidence).filter(isCheckablePath);
    const commands = row.command === undefined ? [] : backticked(row.command);
    const testFiles = evidence.filter((citation) => TEST_FILE.test(citation));
    const reasons = [
      ...shapeReasons(row, commands),
      ...commands.flatMap((command) => {
        /** @type {string[]} */
        const found = [];
        checkCommand(tree, command, found);
        return found;
      }),
      ...citationReasons(root, evidence, qualificationPaths(row.qualification, root)),
      ...collectionReasons(tree, testFiles),
      ...(row.status === 'real' ? realReasons(tree, commands, testFiles) : []),
    ];
    return {
      id: row.id,
      status: row.status,
      commands,
      verdict: /** @type {Verdict} */ (reasons.length === 0 ? 'verified' : 'unverified'),
      reasons,
    };
  });
  return { rows };
}

/**
 * The row's shape: as many cells as the header, and a command.
 *
 * @param {{ cellCount: number, headerCount: number, command: string | undefined }} row
 * @param {string[]} commands
 * @returns {string[]}
 */
function shapeReasons(row, commands) {
  /** @type {string[]} */
  const reasons = [];
  if (row.cellCount !== row.headerCount) {
    reasons.push(
      `the row has ${String(row.cellCount)} cells and the header has ${String(row.headerCount)}; ` +
        'a shifted cell puts a value under the wrong column',
    );
  }
  if (row.command === undefined) {
    reasons.push('the register has no Command column, so the row names no command');
  } else if (commands.length === 0) {
    reasons.push('the row names no command; a path is evidence that code exists, not that it runs');
  }
  return reasons;
}

/**
 * Every cited file exists: the Evidence cell's, and the paths the prose points at.
 *
 * @param {string} root
 * @param {string[]} evidence
 * @param {string[]} prose
 * @returns {string[]}
 */
function citationReasons(root, evidence, prose) {
  return [
    ...evidence
      .filter((citation) => !existsSync(path.join(root, citation)))
      .map((citation) => `evidence ${citation} does not exist`),
    ...prose
      .filter((citation) => !existsSync(path.join(root, citation)))
      .map((citation) => `the qualification cites \`${citation}\`, which does not exist`),
  ];
}

/**
 * Every cited test file that exists is collected by some runner.
 *
 * @param {Tree} tree
 * @param {string[]} testFiles
 * @returns {string[]}
 */
function collectionReasons(tree, testFiles) {
  return testFiles
    .filter((file) => existsSync(path.join(tree.root, file)) && !isCollected(tree, file))
    .map((file) => `evidence test ${file} is not collected by any test config or test script`);
}

/**
 * A row asserting `real` rests on a test file that exists, or on a root gate script.
 *
 * @param {Tree} tree
 * @param {string[]} commands
 * @param {string[]} testFiles
 * @returns {string[]}
 */
function realReasons(tree, commands, testFiles) {
  const restsOnGate = commands.some((command) => {
    const argv = command.split(/\s+/).filter(Boolean);
    return (
      argv[0] === 'pnpm' && argv[1] !== '--filter' && tree.rootScripts[argv[1] ?? ''] !== undefined
    );
  });
  const hasTest = testFiles.some((file) => existsSync(path.join(tree.root, file)));
  return hasTest || restsOnGate
    ? []
    : [
        'the row asserts `real` but cites no test file and names no root gate script, so ' +
          'nothing that could fail stands behind the word',
      ];
}

/**
 * Runs `pnpm` through the platform shell.
 *
 * @param {string} command
 * @param {string} root
 * @returns {{ status: number, output: string }}
 */
export function execCommand(command, root) {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`,
  };
}

/**
 * Executes the commands of the rows that passed the static pass, once per distinct
 * command, and flips a row to `unverified` when any of its commands exits non-zero.
 * A row that already failed statically is not run: the command of a row whose
 * evidence is gone proves nothing about it.
 *
 * @param {Report} report
 * @param {{ root: string, exec?: (command: string) => { status: number, output: string } }} options
 * @returns {Report}
 */
export function runCommands(report, options) {
  const exec =
    options.exec ?? ((/** @type {string} */ command) => execCommand(command, options.root));
  /** @type {Map<string, { status: number, output: string }>} */
  const outcomes = new Map();
  for (const row of report.rows) {
    if (row.verdict !== 'verified') continue;
    for (const command of row.commands) {
      if (!outcomes.has(command)) outcomes.set(command, exec(command));
    }
  }
  return {
    rows: report.rows.map((row) => {
      if (row.verdict !== 'verified') return row;
      const reasons = row.commands.flatMap((command) => {
        const outcome = outcomes.get(command);
        if (outcome === undefined || outcome.status === 0) return [];
        const tail = outcome.output.trim().split(/\r?\n/).slice(-3).join(' / ');
        return [
          `command \`${command}\` exited ${String(outcome.status)}${tail ? `: ${tail}` : ''}`,
        ];
      });
      return {
        ...row,
        reasons,
        verdict: /** @type {Verdict} */ (reasons.length === 0 ? 'verified' : 'unverified'),
      };
    }),
  };
}
