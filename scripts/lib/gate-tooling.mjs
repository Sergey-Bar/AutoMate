/**
 * CI wiring audit: does every gate in `.github/workflows/` have the tooling it
 * needs to actually reach its last step?
 *
 * Four of the nine jobs in `unified-ci.yml`, and every job in `nightly.yml`,
 * were red by construction. `scripts/static-analysis.mjs` exits non-zero when
 * `semgrep` or `gitleaks` is missing — correctly, because an unrun security scan
 * is not a pass — and no job installed either binary. So `security`, all of
 * `nightly.yml`, and `release-gate.yml`'s `verify` failed on their first step and
 * never reached the secret scan, licence check, duplication, complexity, or
 * capability-register steps queued behind it. The three E2E jobs died earlier
 * still: `playwright.config.ts` throws without `DATABASE_URL`, and no workflow
 * declared a `services:` block.
 *
 * `test:performance` was worse than red — it was wired into no workflow at all,
 * so a gate nobody ever ran reported nothing.
 *
 * This module reads `scripts/gate-tooling.json` and the workflows, and reports
 * every one of those as a finding. It is the `coverage-exclusions.md` register
 * pattern applied to CI wiring: a documented, machine-checked list rather than a
 * convention someone has to remember.
 *
 * Parsing is a YAML subset — block maps, block sequences, block scalars, and
 * plain/quoted scalars — because this repository has no YAML dependency and
 * `unify-preflight.mjs` already parses workflow text the same way. A workflow
 * using a construct outside the subset raises rather than being silently
 * misread, so the gate cannot pass on an absence.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_SCANNERS_ENV } from './host-scanners.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export const WORKFLOW_DIR = path.join(root, '.github', 'workflows');
export const MANIFEST_PATH = path.join(root, 'scripts', 'gate-tooling.json');

/**
 * Every YAML file under `.github/` that GitHub Actions will execute.
 *
 * Deliberately wider than {@link WORKFLOW_DIR}. `.github/actions/install-scanners`
 * is a *composite* action used by all three workflows, and a composite action can
 * set a step-scoped `env:` that every later step in the calling job inherits — so
 * a variable set there is set for the job that runs the security gate. An audit
 * that read only the workflow directory would clear CI while the gate it guards
 * was being quietly switched off, which is the direction of error that matters.
 *
 * @returns {string[]} paths relative to the repository root, `/`-separated
 */
export function listActionFiles() {
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) found.push(full);
    }
  };
  walk(path.join(root, '.github'));
  return found.sort();
}

/** pnpm commands that are not root package scripts. */
const PNPM_BUILTINS = new Set([
  'add',
  'approve-builds',
  'audit',
  'config',
  'create',
  'deploy',
  'dlx',
  'doctor',
  'env',
  'exec',
  'i',
  'import',
  'info',
  'install',
  'licenses',
  'link',
  'list',
  'login',
  'logout',
  'ls',
  'outdated',
  'pack',
  'patch',
  'patch-commit',
  'prune',
  'publish',
  'rebuild',
  'recursive',
  'recursive-run',
  'rm',
  'run',
  'run-script',
  'store',
  'unlink',
  'uninstall',
  'update',
  'up',
  'view',
  'whoami',
  'why',
]);

/**
 * pnpm subcommands that consume the rest of the line, so nothing after a filter
 * can be a root script.
 *
 * `run` and `run-script` are deliberately absent: `pnpm --filter <pkg> run <script>`
 * names a *package* script, and the audit has always reported that as no root
 * reference. Every other subcommand here means the line is not running a script
 * from the root package.json at all.
 */
const PNPM_SUBCOMMANDS = new Set([
  'exec',
  'dlx',
  'add',
  'install',
  'i',
  'create',
  'import',
  'publish',
  'pack',
]);

/** pnpm flags that mean the following token is a package filter, not a script. */
const PNPM_FILTER_FLAGS = new Set([
  '--filter',
  '-F',
  '--workspace-root',
  '-w',
  '--recursive',
  '-r',
]);

/** Verbs that mean a `run:` line installs a tool rather than invoking one. */
const INSTALL_VERBS =
  /\b(?:install|add|pipx?\s+install|brew\s+install|apt-get\s+install|apt\s+install|setup-k6-action)\b/;

/**
 * Parses the YAML subset the workflows use.
 *
 * @param {string} source
 * @returns {Record<string, unknown>}
 */
/**
 * One structural line of a workflow.
 *
 * @typedef {object} ParsedLine
 * @property {number} indent
 * @property {string} text
 * @property {string} [blockScalar]
 */

/**
 * The block scalar being collected, or `null`.
 *
 * Declared rather than inferred: `let openBlock = null` narrows `parts` to
 * `never[]`, so the later `parts.push(raw)` fails to typecheck — the error points
 * at the push and means the initial value was untyped.
 *
 * @typedef {{ indent: number, parts: string[], lineIndex: number } | null} OpenBlock
 */

/**
 * A `key: |` / `key: >` line, or null.
 *
 * @param {string} raw
 * @returns {RegExpExecArray | null}
 */
function blockScalarOpener(raw) {
  return /^( *)([A-Za-z0-9_.$-]+):[ \t]*[|>][-+]?[ \t]*$/.exec(raw);
}

/**
 * Reduces a source file to structural lines.
 *
 * Block-scalar content is opaque: a line inside it may be blank, start with `#`,
 * or carry any indentation, and none of it is structure. It is collected here, in
 * the same pass that recognises the `key: |` that opens it, and handed to the
 * reader as a finished value.
 *
 * Split out of `parseWorkflow` because that function was a loop with four
 * conditions, a block-scalar state machine and a nested parser inside it — which
 * is what `scripts/complexity-gate.mjs` measured.
 *
 * @param {string} source
 * @returns {ParsedLine[]}
 */
function structuralLines(source) {
  /** @type {ParsedLine[]} */
  const lines = [];
  /** @type {OpenBlock} */
  let openBlock = null;
  /** Finishes the block scalar, if one is open, and writes it onto its line. */
  const close = () => {
    if (openBlock === null) return;
    const target = lines[openBlock.lineIndex];
    if (target !== undefined) target.blockScalar = dedent(openBlock.parts, openBlock.indent);
    openBlock = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    if (openBlock !== null) {
      const indent = raw.length - raw.trimStart().length;
      if (raw.trim() === '' || indent > openBlock.indent) {
        openBlock.parts.push(raw);
        continue;
      }
      close();
    }

    const opener = blockScalarOpener(raw);
    if (opener !== null) {
      const indent = (opener[1] ?? '').length;
      lines.push({ indent, text: `${opener[2] ?? ''}:` });
      openBlock = { indent, parts: [], lineIndex: lines.length - 1 };
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    lines.push({ indent: raw.length - raw.trimStart().length, text: stripComment(trimmed) });
  }
  close();
  return lines;
}

/**
 * Reads structural lines into nested maps and sequences.
 *
 * A reader over an already-reduced line list, with a shared cursor, so the three
 * shapes can call each other without threading state through every signature.
 *
 * @param {ParsedLine[]} lines
 * @returns {Record<string, unknown>}
 */
function readLines(lines) {
  let cursor = 0;

  /**
   * @param {number} indent
   * @returns {Record<string, unknown> | unknown[] | null}
   */
  function parseBlock(indent) {
    const line = lines[cursor];
    if (line === undefined || line.indent !== indent) return null;
    return line.text.startsWith('- ') ? parseSequence(indent) : parseMap(indent);
  }

  /**
   * @param {string} text
   * @returns {boolean} true when the dash line opens a mapping rather than a value
   */
  function opensMapping(text) {
    return /^[A-Za-z0-9_.$-]+:(\s|$)/.test(text);
  }

  /** @param {number} indent @returns {unknown[]} */
  function parseSequence(indent) {
    /** @type {unknown[]} */
    const items = [];
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line === undefined || line.indent !== indent || !line.text.startsWith('- ')) break;
      const inline = line.text.slice(2);
      const inlineIndent = indent + 2;
      cursor += 1;
      if (!opensMapping(inline)) {
        items.push(parseScalar(inline));
        continue;
      }
      // A mapping that starts on the dash line. Its remaining keys sit at the
      // inline indent, so it is rewritten as a nested block and re-read.
      lines.splice(cursor, 0, { indent: inlineIndent, text: inline });
      const parsed = parseMap(inlineIndent);
      if (parsed !== null) items.push(parsed);
    }
    return items;
  }

  /**
   * The value of one `key:` line, given the line that follows it.
   *
   * Split out of `parseMap` because that function had four branches and a loop,
   * and `scripts/complexity-gate.mjs` measures the sum of them rather than the
   * file's length.
   *
   * @param {string} value the text after the colon
   * @param {number} indent the key's own indent
   * @returns {unknown}
   */
  function valueFor(value, indent) {
    if (value === '') {
      const next = lines[cursor];
      // An empty value is a nested block only when the next line is indented
      // further. `workflow_dispatch:` followed by a sibling `permissions:` is a
      // null value, and reading it as a block would swallow the rest of the
      // document into the trigger — which is how a whole workflow once parsed as
      // a workflow with no jobs.
      return next !== undefined && next.indent > indent ? parseBlock(next.indent) : null;
    }
    return parseScalar(value);
  }

  /** @param {number} indent @returns {Record<string, unknown> | null} */
  function parseMap(indent) {
    /** @type {Record<string, unknown>} */
    const map = {};
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent)
        throw new Error(`gate-tooling: unexpected indentation in workflow at "${line.text}"`);
      if (line.text.startsWith('- ')) break;

      const separator = findKeySeparator(line.text);
      if (separator === -1)
        throw new Error(`gate-tooling: unparseable workflow line "${line.text}"`);
      const key = line.text.slice(0, separator).trim();
      const value = line.text.slice(separator + 1).trim();
      cursor += 1;

      map[key] = line.blockScalar ?? valueFor(value, indent);
    }
    return map;
  }

  const document = parseMap(lines[0]?.indent ?? 0);
  if (cursor < lines.length)
    throw new Error(`gate-tooling: unparsed workflow content at "${lines[cursor]?.text ?? ''}"`);
  return document ?? {};
}

/**
 * Parses the YAML subset the workflows use.
 *
 * @param {string} source
 * @returns {Record<string, unknown>}
 */
export function parseWorkflow(source) {
  return readLines(structuralLines(source));
}

/**
 * Strips the block scalar's own indentation from every line, keeping the value
 * as written.
 *
 * @param {string[]} parts
 * @param {number} indent
 */
function dedent(parts, indent) {
  const kept = parts.filter((part) => part.trim() !== '');
  const width = kept.reduce(
    (least, part) => Math.min(least, part.length - part.trimStart().length),
    Infinity,
  );
  const base = Number.isFinite(width) ? Math.max(width, indent + 2) : indent + 2;
  return parts.map((part) => (part.trim() === '' ? '' : part.slice(base))).join('\n');
}

/** @param {string} line */
function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1] ?? '')))
      return line.slice(0, index).trim();
  }
  return line;
}

/**
 * The first `:` that separates a key from a value.
 *
 * A `:` inside a quoted key is skipped, and a `:` followed by `/` is part of a
 * value (`http://…`) rather than a separator.
 *
 * @param {string} text
 */
function findKeySeparator(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ':' && text[index + 1] !== '/') return index;
  }
  return -1;
}

/** @param {string} value */
function parseScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    return trimmed;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * One script's row in `scripts/gate-tooling.json`.
 *
 * `installedBy` is the key that makes a finding actionable: "no step installs
 * semgrep" is a fact, and "a step should install it, and this is the action that
 * does" is a fix. Every key here is optional because a row states only what applies
 * to it — a script that needs nothing declares nothing.
 *
 * @typedef {object} GateToolingRow
 * @property {string[]} [includes]   scripts this one chains, flattened transitively
 * @property {string[]} [requires]   external binaries it needs
 * @property {boolean} [preinstalledInJobImage] true when the image already has them
 * @property {string} [installedBy]  the step or action that should install them
 * @property {string} [why]          why the requirement exists
 */

/**
 * What one external binary is for, and which scripts need it.
 *
 * @typedef {object} GateToolingSpec
 * @property {string[]} [requiredByScripts] the scripts that fail without the binary
 * @property {string} [satisfiedByJobService] a service container that provides it
 */

/**
 * One script's flattened external requirements.
 *
 * At module scope rather than inside `effectiveRequirements`, because a `@returns` is
 * resolved where it is written: a typedef declared in the function body is invisible to
 * the annotation above it and to every call site, which is how `installedBy` came to be
 * "not a property" three times in three different files' worth of confusion.
 *
 * @typedef {object} ResolvedRequirements
 * @property {string[]} requires
 * @property {boolean} preinstalledInJobImage
 * @property {string} [installedBy] carried in from whichever row declared it
 */

/**
 * The manifest.
 *
 * @typedef {object} GateToolingManifest
 * @property {Record<string, GateToolingRow>} scripts
 * @property {Record<string, GateToolingSpec>} [environment] per-binary requirements
 * @property {Record<string, string>} [tiers] script name to its plan-D6 tier
 * @property {string[]} [$comment] the manifest's own rationale
 */

/** @returns {GateToolingManifest} */
export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

/**
 * Flattens `includes`, so a requirement declared on a composed script reaches
 * the job that invokes the umbrella.
 *
 * `pnpm security:verify` chains `pnpm security:static`; a manifest that only
 * described the inner script would see a job whose `run:` never names it and
 * report no missing tool — which is the red-by-construction security job, one
 * indirection away.
 *
 * @param {GateToolingManifest} manifest
 * @returns {Map<string, ResolvedRequirements>}
 */
export function effectiveRequirements(manifest) {
  /** @type {Map<string, ResolvedRequirements>} */
  const resolved = new Map();

  /**
   * @param {string} name
   * @param {Set<string>} seen
   */
  function resolve(name, seen) {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name)) return { requires: [], preinstalledInJobImage: false };
    seen.add(name);

    const entry = manifest.scripts[name];
    if (entry === undefined) return { requires: [], preinstalledInJobImage: false };

    const requires = [...(entry.requires ?? [])];
    let preinstalled = entry.preinstalledInJobImage === true;
    let installedBy = entry.installedBy;
    for (const included of entry.includes ?? []) {
      const nested = resolve(included, seen);
      requires.push(...nested.requires);
      preinstalled = preinstalled || nested.preinstalledInJobImage;
      installedBy = installedBy ?? nested.installedBy;
    }

    const value = {
      // A requirement reachable by two paths is one requirement, not two
      // identical findings about the same missing tool.
      requires: [...new Set(requires)],
      preinstalledInJobImage: preinstalled,
      installedBy,
    };
    resolved.set(name, value);
    return value;
  }

  for (const name of Object.keys(manifest.scripts)) resolve(name, new Set());
  return resolved;
}

/** @returns {Set<string>} */
export function readRootScripts() {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return new Set(Object.keys(pkg.scripts ?? {}));
}

/**
 * The command behind one root script, or `''`.
 *
 * Separate from `readRootScripts` because the names and the commands answer
 * different questions: the audit needs to know a name exists, and the D6 budget
 * needs to know what `verify` actually chains.
 *
 * @param {string} name
 * @returns {string}
 */
export function readRootScriptCommand(name) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.scripts?.[name] ?? '';
}

/** @returns {string[]} */
export function listWorkflows() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();
}

/**
 * The tiers a root script may carry, and the four D6 named plus the fifth the
 * baseline writers need.
 *
 * `never-in-ci` is a first-class value rather than a compromise: `dev`,
 * `db:migrate` and the `*:baseline` writers are run by hand on purpose, and a
 * `*:baseline` script inside a workflow is a way of making a gate agree with the
 * tree instead of with the code.
 */
export const TIERS = new Set(['pr-blocking', 'pr-reporting', 'nightly', 'release', 'never-in-ci']);

/**
 * Every way the tier register disagrees with the root scripts, as findings.
 *
 * Exported rather than inlined in the test because two callers need it and one
 * implementation is the point: `gate-tooling.test.mjs` asserts it, and
 * `scripts/lib/status-ten.mjs` reports the same facts as the twelve-point
 * measurement. A second copy of this rule is a second place for the classification
 * to be wrong, and the whole reason this is in `gate-tooling.json` rather than in
 * a convention is that a convention is not checkable.
 *
 * @param {GateToolingManifest} manifest
 * @param {Set<string>} rootScripts
 * @returns {string[]}
 */
export function tierRegisterProblems(manifest, rootScripts) {
  const tiers = manifest.tiers ?? {};
  /** @type {string[]} */
  const findings = [];

  for (const name of [...rootScripts].sort()) {
    if (tiers[name] === undefined) {
      findings.push(`${name}: a root script with no tier in scripts/gate-tooling.json`);
    }
  }
  for (const [name, tier] of Object.entries(tiers)) {
    if (typeof tier !== 'string') continue; // the `$comment` key
    if (!TIERS.has(tier)) findings.push(`${name}: unknown tier "${tier}"`);
    if (!rootScripts.has(name)) {
      findings.push(`${name}: gate-tooling.json tiers "${name}", which is not a root script`);
    }
  }

  // `verify` must not have outgrown its budget. D6: 13 steps today, at most 20.
  // This is the count that has to be edited deliberately rather than discovered
  // when the PR queue turns red.
  const steps = readRootScriptCommand('verify')
    .split('&&')
    .map((step) => step.trim())
    .filter(Boolean);
  if (steps.length > 20) {
    findings.push(
      `verify has ${String(steps.length)} steps, over the plan's budget of 20. Move the new ` +
        'one to nightly rather than raising the budget.',
    );
  }
  if (steps.some((step) => step.includes('migrate:apply'))) {
    findings.push('migrate:apply must never enter verify: CI has no persistent database');
  }

  return findings;
}

/**
 * The argv index of the token a `pnpm` invocation is really about.
 *
 * Skips flags, and — crucially — the package selectors that follow
 * `pnpm --filter`. `pnpm --filter @automate/worker test` names a package script,
 * not a root one, and reading `test` as a root script would report a missing
 * script that does not exist.
 *
 * @param {string[]} argv
 * @param {number} from
 * @returns {number}
 */
function scriptArgvIndex(argv, from) {
  let index = from;
  while (index < argv.length && (argv[index] ?? '').startsWith('-')) {
    if (PNPM_FILTER_FLAGS.has(argv[index] ?? '')) {
      // Everything up to the next flag is a package selector, not a script.
      index += 1;
      while (index < argv.length && !(argv[index] ?? '').startsWith('-')) {
        // …unless it is a pnpm subcommand, in which case the filter's value list has
        // ended and the line names no root script at all.
        //
        // The loop used to run to the next *flag* only, so
        // `pnpm --filter @automate/unified-web exec vite --host 127.0.0.1` swallowed
        // `exec` and `vite` as selectors, walked past `--host`, and reported the
        // audit as running a root script called `127.0.0.1`. `run` and `run-script`
        // are excluded because `pnpm --filter <pkg> run <script>` is a *package*
        // script, which this audit has always reported as no root reference.
        if (PNPM_SUBCOMMANDS.has(argv[index] ?? '')) return -1;
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return index;
}

/**
 * The root script one `pnpm` invocation names, or null for a builtin.
 *
 * @param {string[]} argv
 * @param {number} index
 * @returns {string | null}
 */
function scriptFromArgv(argv, index) {
  const name = argv[index];
  if (name === undefined) return null;
  // `pnpm <script>` is shorthand for `pnpm run <script>`, and `run` is not a
  // builtin — it needs the token after it.
  if (name === 'run' || name === 'run-script') return argv[index + 1] ?? null;
  if (PNPM_BUILTINS.has(name)) return null;
  return name;
}

/**
 * Every root-script reference a `run:` line makes, ignoring filtered and builtin
 * invocations.
 *
 * @param {string} run
 * @returns {string[]}
 */
export function referencedScripts(run) {
  const found = [];
  // Each shell command, then its argv. Splitting on the shell operators first
  // keeps `pnpm a && pnpm b` two invocations instead of one, which is how the
  // reference in a chained gate step was previously missed.
  for (const command of run.split(/\r?\n|[;&|]+/)) {
    const argv = command.trim().split(/\s+/).filter(Boolean);
    const pnpmAt = argv.indexOf('pnpm');
    if (pnpmAt === -1) continue;
    const index = scriptArgvIndex(argv, pnpmAt + 1);
    // -1 is the signal that a pnpm subcommand ended a filter's value list, so the
    // line names no root script.
    if (index === -1) continue;
    const script = scriptFromArgv(argv, index);
    if (script !== null) found.push(script);
  }
  return found;
}

/**
 * A whole-word matcher for a tool name, so `k6` matches `setup-k6-action` and
 * `gitleaks` matches `gitleaks-action` without matching an unrelated word.
 *
 * @param {string} tool
 * @returns {RegExp}
 */
function wordFor(tool) {
  return new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

/**
 * @param {string} text
 * @param {string} tool
 */
function installsTool(text, tool) {
  if (wordFor(tool).test(text) === false) return false;
  return INSTALL_VERBS.test(text);
}

/**
 * One step of a job, as this parser produces it.
 *
 * @typedef {object} WorkflowStep
 * @property {string} [uses]
 * @property {string} [run]
 * @property {string} [name]
 * @property {string} [with]
 */

/**
 * Whether one step's `uses:` reference supplies the tool.
 *
 * @param {string} uses
 * @param {string} tool
 * @param {string | undefined} installedBy
 * @returns {boolean}
 */
function usesSuppliesTool(uses, tool, installedBy) {
  // A local composite action is referenced as `./path`, and the manifest records
  // it without that prefix.
  const reference = uses.split('@')[0]?.replace(/^\.\//, '') ?? '';
  if (installedBy !== undefined && reference === installedBy) return true;
  // `grafana/setup-k6-action` names its tool inside a longer path segment, so this
  // is a word anywhere in the reference, not a whole segment.
  return wordFor(tool).test(uses);
}

/**
 * @param {Record<string, unknown>} job
 * @param {string} tool
 * @param {string | undefined} installedBy
 */
function jobInstallsTool(job, tool, installedBy) {
  for (const step of /** @type {WorkflowStep[]} */ (job.steps ?? [])) {
    if (typeof step.uses === 'string' && usesSuppliesTool(step.uses, tool, installedBy))
      return true;
    if (typeof step.run === 'string' && installsTool(step.run, tool)) return true;
    const withBlock = step.with;
    if (
      withBlock !== undefined &&
      Object.values(withBlock).some((value) => installsTool(String(value), tool))
    )
      return true;
  }
  return false;
}

/**
 * The tools a job running `script` is missing an install step for.
 *
 * @param {string} label
 * @param {string} script
 * @param {Record<string, unknown>} job
 * @param {ResolvedRequirements | undefined} requirements
 * @returns {string[]}
 */
function missingToolFindings(label, script, job, requirements) {
  if (requirements === undefined || requirements.preinstalledInJobImage === true) return [];
  /** @param {string} raw */
  const unsupplied = (raw) =>
    !raw.split('|').some((tool) => jobInstallsTool(job, tool, requirements.installedBy));
  return requirements.requires
    .filter(unsupplied)
    .map(
      (raw) =>
        `${label}: runs \`pnpm ${script}\`, which needs ${raw}, but no step installs it. ` +
        'The gate will exit not_configured and every step behind it will never run.',
    );
}

/**
 * The environment variables a job running `script` is missing.
 *
 * @param {string} label
 * @param {string} script
 * @param {Record<string, unknown>} jobEnv
 * @param {Record<string, unknown>} services
 * @param {GateToolingManifest} manifest
 * @returns {string[]}
 */
function missingEnvFindings(label, script, jobEnv, services, manifest) {
  /** @type {string[]} */
  const findings = [];
  for (const [variable, spec] of Object.entries(manifest.environment ?? {})) {
    if (!(spec.requiredByScripts ?? []).includes(script)) continue;
    if (jobEnv[variable] !== undefined) continue;
    if (
      spec.satisfiedByJobService !== undefined &&
      services[spec.satisfiedByJobService] !== undefined
    )
      continue;
    findings.push(
      `${label}: runs \`pnpm ${script}\`, which requires $${variable}, and neither \`env\` nor a ` +
        `\`${String(spec.satisfiedByJobService)}\` service provides it. playwright.config.ts throws ` +
        'without it, so the job dies at config load.',
    );
  }
  return findings;
}

/**
 * What a job that runs one root script is missing.
 *
 * Split out of `auditWorkflow` so each function answers one question. It was one
 * function of four nested loops, and `scripts/complexity-gate.mjs` correctly
 * reported it over the cognitive-complexity limit — which is that gate working,
 * not a threshold to raise.
 *
 * @param {string} label
 * @param {string} script
 * @param {Record<string, unknown>} job
 * @param {Record<string, unknown>} jobEnv
 * @param {Record<string, unknown>} services
 * @param {Set<string>} rootScripts
 * @param {Map<string, ResolvedRequirements>} requirements
 * @param {GateToolingManifest} manifest
 * @returns {string[]}
 */
function auditScript(label, script, job, jobEnv, services, rootScripts, requirements, manifest) {
  if (!rootScripts.has(script)) {
    return [
      `${label}: runs \`pnpm ${script}\`, which is not a script in the root package.json. ` +
        'A renamed or deleted script fails only at run time.',
    ];
  }
  return [
    ...missingToolFindings(label, script, job, requirements.get(script)),
    ...missingEnvFindings(label, script, jobEnv, services, manifest),
  ];
}

/**
 * Every root script one job's steps name, in order and without repeats.
 *
 * @param {Record<string, unknown>} job
 * @returns {string[]}
 */
function scriptsRunByJob(job) {
  /** @type {string[]} */
  const found = [];
  for (const step of /** @type {WorkflowStep[]} */ (job.steps ?? [])) {
    for (const script of referencedScripts(typeof step.run === 'string' ? step.run : '')) {
      if (!found.includes(script)) found.push(script);
    }
  }
  return found;
}

/**
 * Every `env:` block in the file, with the scope that owns it.
 *
 * Annotated as a tuple array because the literal otherwise widens: mixing
 * `['workflow', {...}]` with `Object.entries(...).map(...)` produces
 * `(string | Record<string, unknown>)[]`, and indexing *that* with a string is
 * exactly the error the annotation removes.
 *
 * @param {Record<string, unknown>} workflow
 * @param {Record<string, Record<string, unknown>>} jobs
 * @returns {Array<[string, Record<string, unknown>]>}
 */
function envScopes(workflow, jobs) {
  return [
    ['workflow', /** @type {Record<string, unknown>} */ (workflow['env'] ?? {})],
    ...Object.entries(jobs).map(
      /** @returns {[string, Record<string, unknown>]} */
      ([jobId, job]) => [jobId, /** @type {Record<string, unknown>} */ (job?.['env'] ?? {})],
    ),
  ];
}

/**
 * Audits one workflow file.
 *
 * @param {string} file
 * @param {string} source
 * @param {GateToolingManifest} manifest
 * @param {Set<string>} rootScripts
 * @returns {string[]}
 */
export function auditWorkflow(file, source, manifest, rootScripts) {
  /** @type {string[]} */
  const findings = [];
  const workflow = parseWorkflow(source);
  const requirements = effectiveRequirements(manifest);
  const jobs = /** @type {Record<string, Record<string, unknown>>} */ (workflow['jobs'] ?? {});

  if (jobs === null || typeof jobs !== 'object' || Object.keys(jobs).length === 0) {
    findings.push(
      `${file}: no jobs found; a workflow with no jobs passes every gate by running none`,
    );
  }
  if (workflow['concurrency'] === undefined) {
    findings.push(
      `${file}: no \`concurrency\` block, so overlapping runs are possible and a stale ` +
        'green from a superseded commit can be read as the current one',
    );
  }
  // Checked against the parsed `env`, not the raw text: the reasoning for not
  // setting this variable belongs in a comment beside the job, and a substring
  // search would report that explanation as the violation it forbids.
  for (const [scope, values] of envScopes(workflow, jobs)) {
    if (values['E2E_ALLOW_IN_MEMORY'] === undefined) continue;
    findings.push(
      `${file}[${scope}]: sets E2E_ALLOW_IN_MEMORY, which lets the E2E suite pass without ` +
        'PostgreSQL. That switch is for a deliberate local run, not a release signal.',
    );
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    const label = `${file}[${jobId}]`;
    if (job['timeout-minutes'] === undefined) {
      findings.push(
        `${label}: no \`timeout-minutes\`, so a hung gate occupies a runner until the 6-hour default`,
      );
    }

    /** @type {Record<string, unknown>} */
    const jobEnv = {
      .../** @type {Record<string, unknown>} */ (workflow['env'] ?? {}),
      .../** @type {Record<string, unknown>} */ (job['env'] ?? {}),
    };
    const services = /** @type {Record<string, unknown>} */ (job['services'] ?? {});

    for (const script of scriptsRunByJob(job)) {
      findings.push(
        ...auditScript(label, script, job, jobEnv, services, rootScripts, requirements, manifest),
      );
    }

    findings.push(...silentSkipFindings(label, job, manifest, rootScripts));
  }

  return findings;
}

/**
 * A `pr-blocking` gate that a workflow is allowed to fail.
 *
 * W0.9's `no-silent-skip` rule, and the reason it is tier-aware rather than
 * absolute. `continue-on-error` on a `nightly` or `pr-reporting` job is a
 * deliberate classification — `migration-report` and the migration-rehearsal job
 * both carry it, with the reasoning in a comment beside the job — and a rule that
 * forbade it would push those jobs to be deleted rather than demoted, which is a
 * worse outcome than the one it prevents.
 *
 * The same `continue-on-error` on a job running a `pr-blocking` script is the
 * defect: the gate is required, it is the gate the tier says blocks the merge,
 * and the workflow says its result does not matter. `|| true` in a `run:` is the
 * same statement written in the shell, and it is read from the parsed `run` value
 * rather than the raw text so a comment explaining the choice is not reported as
 * the choice.
 *
 * @param {string} label
 * @param {Record<string, unknown>} job
 * @param {GateToolingManifest} manifest
 * @param {Set<string>} rootScripts
 * @returns {string[]}
 */
function silentSkipFindings(label, job, manifest, rootScripts) {
  const tiers = manifest.tiers ?? {};
  /** @type {string[]} */
  const findings = [];
  const steps = /** @type {WorkflowStep[]} */ (job.steps ?? []);

  /**
   * @param {string} where
   * @param {string} how the tolerance, or `''` when the step tolerates nothing
   * @param {string} run
   */
  const report = (where, how, run) => {
    if (how === '') return;
    const blocking = referencedScripts(run).filter(
      (script) => rootScripts.has(script) && tiers[script] === 'pr-blocking',
    );
    if (blocking.length === 0) return;
    findings.push(
      `${where}: ${how} around ${blocking.map((s) => `\`pnpm ${s}\``).join(', ')}, which ` +
        'gate-tooling.json tiers `pr-blocking`. A required gate whose result a workflow is ' +
        'allowed to discard reports green whether it ran or not.',
    );
  };

  /**
   * Whether a value is the workflow's `true`.
   *
   * The parser here is a YAML subset that keeps every scalar as a string, so
   * `continue-on-error: true` arrives as `"true"` and a strict `=== true` would
   * clear every finding this function exists to raise — which is the direction of
   * error that matters, because the check would then report a clean repository.
   *
   * @param {unknown} value
   * @returns {boolean}
   */
  const tolerated = (value) => value === true || value === 'true';

  /**
   * The step's `continue-on-error`, read through a cast.
   *
   * The key is not an identifier, so a JSDoc property cannot declare it and
   * `checkJs` rejects the bracket access without one. A cast is the narrowest
   * thing that type-checks; the alternative is a parser that camel-cases the key,
   * which would put a spelling choice between this check and every other reader of
   * the parsed workflow.
   *
   * @param {WorkflowStep} step
   * @returns {unknown}
   */
  const stepTolerance = (step) =>
    /** @type {{ 'continue-on-error'?: unknown }} */ (step)['continue-on-error'];

  for (const step of steps) {
    const run = typeof step.run === 'string' ? step.run : '';
    const where = `${label} step "${String(step.name ?? '(unnamed)')}"`;
    if (tolerated(stepTolerance(step))) {
      report(where, '`continue-on-error: true`', run);
    }
    if (run.includes('|| true')) report(where, '`|| true` in the step', run);
  }
  // Job-level `continue-on-error` is inherited by every step, so it is reported
  // once against the job and names every blocking script the job runs.
  //
  // Only when the job runs **nothing that already reports**. `nightly.yml`'s smoke
  // job carries the flag and also runs `pnpm build`, which is `pr-blocking` — but
  // `build` there is a prerequisite for `smoke:local`, whose tier is `nightly` and
  // whose non-blocking is the decision the flag records. Reporting it would have
  // been a false positive on a real workflow, and a gate that reports a correct
  // decision as a defect gets switched off rather than refined.
  //
  // The residual gap is deliberate: a job that runs a `pr-blocking` gate *and* a
  // reporting gate under one flag is not reported, because telling those two apart
  // needs to know which script the job is for, and that is a judgement rather than
  // a fact about the file.
  if (tolerated(job['continue-on-error'])) {
    const run = scriptsRunByJob(job);
    const reports = run.some(
      (script) => tiers[script] === 'pr-reporting' || tiers[script] === 'nightly',
    );
    if (!reports)
      report(label, '`continue-on-error: true`', run.map((s) => `pnpm ${s}`).join(' && '));
  }
  return findings;
}

/** @returns {string[]} */
export function auditRepository() {
  const manifest = readManifest();
  const rootScripts = readRootScripts();
  /** @type {string[]} */
  const findings = [];
  for (const file of listWorkflows()) {
    const source = readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
    try {
      findings.push(...auditWorkflow(file, source, manifest, rootScripts));
    } catch (error) {
      // A workflow this parser cannot read is a finding, not a skip. Reading it
      // as empty would clear every job in it and report a clean repository, which
      // is how the `product` project became a green job that ran nothing.
      findings.push(
        `${file}: could not be read (${error instanceof Error ? error.message : String(error)}). ` +
          'A workflow the audit cannot parse is not a workflow the audit has cleared.',
      );
    }
  }
  findings.push(...auditHostDegradation());
  return findings;
}

/**
 * The security gate must not be switched off in CI.
 *
 * `AUTOMATE_HOST_SCANNERS=unavailable` turns a scanner that cannot produce a scan
 * into a recorded pass. That is a legitimate trade on a developer laptop and a
 * defect in a pull request: CI is the only place the security scan is enforced, so
 * a job that sets it reports green for a scan that never ran.
 *
 * Read over all of `.github/`, not `.github/workflows/`, because
 * `install-scanners` is a composite action whose step-scoped `env:` every later
 * step in the calling job inherits — a variable set there is set for the job
 * running the gate.
 *
 * Read from raw text rather than the parsed `env`, because the argument for *not*
 * setting it belongs in a comment beside the job, and a structured read would
 * report that explanation as the violation it forbids.
 *
 * @returns {string[]}
 */
function auditHostDegradation() {
  return listActionFiles()
    .filter((file) => readFileSync(file, 'utf8').includes(HOST_SCANNERS_ENV))
    .map(
      (file) =>
        `${path.relative(root, file).replaceAll('\\', '/')}: sets ${HOST_SCANNERS_ENV}, which turns a ` +
        'scanner that could not scan into a pass. The scanners are installed and enforced in CI; the ' +
        'degraded chain is `pnpm verify:local` and is deliberately not run here.',
    );
}
