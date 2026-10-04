/**
 * deps-policy.mjs — the three questions about dependencies nothing was asking.
 *
 * ## Why this exists
 *
 * The tree had a dependency declared that nothing imported, and four documents
 * asserting an architecture that dependency was supposed to provide.
 * `apps/api/package.json` declared `effect`; no file in `workspace imports it; and
 * `AGENTS.md:390` plus four agent personas instructed contributors to *"use Effect
 * for dependency injection and error handling in services"*. Every one of those
 * statements was checkable against the tree and none of the gates looked.
 *
 * That is the same shape as three defects this repository already records. A
 * register row whose status was asserted against a tree that had since moved. Seven
 * documents asserting that a tenancy vulnerability was not yet reportable, five
 * migrations after it became one. A gate reading the declared isolation out of the
 * JSON that declared it. In each case the claim was checkable and the check was
 * absent — so the claim drifted, silently, into being wrong.
 *
 * So this module is three checks, and each one exists because of a real instance:
 *
 * 1. **A declared dependency that nothing imports.** `unusedDependencies`.
 * 2. **A resolved version nobody reviewed.** `compareResolvedToBaseline`.
 * 3. **An override whose review date has arrived.** `expiredOverrideReviews`.
 *
 * ## What deliberately does not check
 *
 * **Whether a version is the newest available.** That needs the network, and a gate
 * that needs the network is a gate that fails on an air-gapped host and gets turned
 * off — which is how `verify:local` came to make a security gate exit 0 without
 * scanning. So question 2 does not ask the registry what the latest version is. It
 * asks whether the version in the lockfile is the version a human recorded a
 * decision about, in `docs/quality/dependency-baseline.json`. A bump therefore
 * cannot happen silently: it has to edit the baseline in the same commit, which puts
 * the old version, the new version and the reviewer on one reviewable line.
 *
 * **Whether a version is vulnerable.** `pnpm audit` does that, from the same
 * lockfile, and `security:verify` runs it.
 *
 * **Whether an unused dependency should be deleted.** That is a judgement about
 * intent, and this module reports rather than decides. The `effect` row was a
 * deliberate adoption, not an accident — see the programme plan, decision D4.
 */

/**
 * @typedef {object} ResolvedDependency
 * @property {string} specifier The range the manifest asked for.
 * @property {string} version What the lockfile resolved it to. `link:` for a
 *   workspace dependency, and a bare semver otherwise — the peer-resolution suffix
 *   pnpm records is resolution detail, not a second version.
 */

/**
 * @typedef {object} ImporterDependencies
 * @property {Record<string, ResolvedDependency>} dependencies
 * @property {Record<string, ResolvedDependency>} devDependencies
 * @property {Record<string, ResolvedDependency>} optionalDependencies
 * @property {Record<string, ResolvedDependency>} peerDependencies
 */

/**
 * @typedef {object} ParsedLockfile
 * @property {Record<string, ImporterDependencies>} importers
 */

/**
 * @typedef {object} UnusedDependency
 * @property {string} name
 * @property {string[]} declaredIn The workspace paths that declare it, `.` for the
 *   root. One finding per package rather than one per declaration: `@types/node` is
 *   declared by twenty-two importers and is unused or used as a unit, so a list of
 *   twenty-two near-identical lines is a report nobody reads, and a report nobody
 *   reads is a gate that has stopped reporting.
 */

/**
 * @typedef {object} BaselineEntry
 * @property {string} name
 * @property {string} version
 */

/**
 * @typedef {object} Baseline
 * @property {BaselineEntry[]} entries
 */

/**
 * @typedef {object} VersionDrift
 * @property {{ name: string, version: string }[]} unreviewed Resolved in the tree,
 *   with no row in the baseline.
 * @property {{ name: string, version: string }[]} stale Recorded in the baseline,
 *   resolved nowhere in the tree.
 * @property {{ name: string, reviewed: string, resolved: string }[]} changed Recorded
 *   at one version, resolved at another.
 */

/**
 * @typedef {object} OverrideReview
 * @property {string} override The override key, unquoted.
 * @property {string | null} reviewedOn The date its provenance claims, or null when
 *   the override carries no date at all — which is reported rather than trusted.
 */

import path from 'node:path';

/** The dependency groups a `pnpm-lock.yaml` importer carries. */
const DEPENDENCY_GROUPS = /** @type {const} */ ([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

/**
 * Strip the surrounding quotes a YAML scalar may carry.
 *
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" || first === '"') && first === last) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * The version a resolution pins, without pnpm's peer suffix.
 *
 * A dependency resolved with a peer context is recorded as `4.60.3(rollup@4.60.3)`.
 * That suffix changes whenever an unrelated package's peer graph moves, so a
 * baseline that stored it would report drift on a peer bump that changed no version
 * this repository reviewed.
 *
 * @param {string} version
 * @returns {string}
 */
function bareVersion(version) {
  const parenIndex = version.indexOf('(');
  return parenIndex === -1 ? version : version.slice(0, parenIndex);
}

/**
 * Parse the `importers` section of a `pnpm-lock.yaml`.
 *
 * The scan stops at the next top-level key. That matters: `packages:` also maps a
 * name to a record, and a parser that kept reading would register `hono@4.12.29:`
 * as an importer called `hono@4.12.29` — a phantom every later check would inherit.
 *
 * @param {string} text The lockfile contents.
 * @returns {ParsedLockfile}
 */
export function parseLockfile(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'importers:');
  if (start === -1) {
    throw new Error(
      'deps-policy: no `importers:` section. This does not look like a pnpm lockfile, ' +
        'and reading it as one would report a tree with no dependencies in it.',
    );
  }

  /** @type {Record<string, ImporterDependencies>} */
  const importers = {};
  /** @type {string | null} */
  let importer = null;
  // The literal union, not `string`. `ImporterDependencies` is a typed record rather
  // than an index signature, so a `string` here cannot index it — which is the point:
  // the group is one of four known names, and the type says so.
  /** @type {(typeof DEPENDENCY_GROUPS)[number] | null} */
  let group = null;
  /** @type {string | null} */
  let dependency = null;

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    // A top-level key ends the section. Everything below it is `packages:` or
    // `snapshots:`, which are keyed by name@version and are not importers.
    if (!/^\s/.test(line)) break;

    if (/^ {2}\S/.test(line) && line.trimEnd().endsWith(':')) {
      importer = unquote(line.trim().slice(0, -1));
      group = null;
      dependency = null;
      importers[importer] = {
        dependencies: {},
        devDependencies: {},
        optionalDependencies: {},
        peerDependencies: {},
      };
      continue;
    }
    if (importer === null) continue;

    if (/^ {4}\S/.test(line)) {
      const candidate = line.trim().replace(':', '');
      group = /** @type {(typeof DEPENDENCY_GROUPS)[number] | null} */ (
        DEPENDENCY_GROUPS.find((name) => name === candidate) ?? null
      );
      dependency = null;
      continue;
    }
    if (group === null) continue;

    if (/^ {6}\S/.test(line) && line.trimEnd().endsWith(':')) {
      dependency = unquote(line.trim().slice(0, -1));
      importers[importer][group][dependency] = { specifier: '', version: '' };
      continue;
    }
    if (dependency === null) continue;

    const entry = /** @type {ResolvedDependency} */ (importers[importer][group][dependency]);
    const specifier = /^ {8}specifier:\s*(.+)$/.exec(line);
    if (specifier) {
      entry.specifier = unquote(specifier[1]);
      continue;
    }
    const version = /^ {8}version:\s*(.+)$/.exec(line);
    if (version) entry.version = bareVersion(unquote(version[1]));
  }

  return { importers };
}

/**
 * Whether a file is configuration rather than application source.
 *
 * A package named in a string counts as a reference here and nowhere else, so this
 * predicate is what stops `effect` being counted as used because some application file
 * contains the literal `'effect'`.
 *
 * **The path is evaluated relative to the repository root, and that is load-bearing.**
 * The first version tested the absolute path, and every segment of it: a worktree at
 * `<repo>/.kilo/worktrees/programme-a` put `.kilo` in the path, which made *every*
 * file in the tree configuration, which made the string rule apply everywhere, which
 * made `effect` — the one finding this gate exists for — disappear. The same failure
 * waits for anyone whose checkout sits under `~/.cache/automate` or `C:\src\.work`.
 * A gate whose verdict depends on where it was run is not a gate.
 *
 * @param {string} file Absolute path to the file.
 * @param {string} root Absolute path to the repository root.
 * @returns {boolean}
 */
export function isConfigurationFile(file, root) {
  const relative = file.startsWith(root) ? path.relative(root, file) : file;
  const normalised = relative.replaceAll('\\', '/');
  const segments = normalised.split('/');
  // A dot-directory — `.storybook/`, `.github/` — holds configuration by convention.
  if (segments.slice(0, -1).some((segment) => segment.startsWith('.') && segment.length > 1)) {
    return true;
  }
  return /\.config\.[cm]?[jt]s$/.test(normalised) || /(^|\/)config\//.test(normalised);
}

/**
 * Whether any source file references a package by import, or by configuration string.
 *
 * Two shapes count, and the second one is scoped narrowly because the broad version of
 * it hid the finding this gate exists for.
 *
 * An **import** — `import x from 'p'`, `import 'p'`, `import('p')`, `require('p')`, and
 * the subpath form of each.
 *
 * A **quoted string equal to the package name, inside a configuration file**.
 * Configuration references packages by string rather than by import:
 * `packages/ui/.storybook/main.ts` lists `'@storybook/addon-essentials'` in its
 * `addons` array, and that package is a real dependency of that package. An
 * import-only matcher reports it unused, and the first thing a reviewer does with a
 * false positive is distrust the whole report.
 *
 * **The scoping is not a detail.** Accepting quoted strings anywhere made `effect`
 * disappear from this gate's output — some file in the tree contains the literal
 * `'effect'` in a position that is not an import, and `effect` is also an English
 * word, so it was being counted as referenced. The one real finding the gate was
 * written for was the one it stopped reporting. Configuration files only: those are
 * where a package name in a string means "this package is needed", and `effect` is not
 * in one.
 *
 * @param {string} name
 * @param {string} source Every non-configuration source file's text.
 * @param {string} configuration Every configuration file's text.
 * @returns {boolean}
 */
function isReferenced(name, source, configuration) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const asSpecifier = new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*['"\`](?:${escaped})(?:/[^'"\`]*)?['"\`]`,
  );
  if (asSpecifier.test(source) || asSpecifier.test(configuration)) return true;
  return new RegExp(`['"\`](?:${escaped})(?:/[^'"\`]*)?['"\`]`).test(configuration);
}

/**
 * Declared dependencies that no source file imports.
 *
 * Exemptions are supplied per importer rather than hard-coded, for two reasons. A
 * tool dependency — `typescript`, `vitest`, `eslint` — is invoked and never
 * imported, and the list of which ones is a decision that changes as the tree does.
 * And an exemption scoped to one importer stops a root-level exemption from
 * silencing the same name inside a package, which is where a genuinely unused
 * dependency would hide.
 *
 * `exemptions['*']` applies to every importer. That is a statement about which names
 * are tools **everywhere** — `typescript` is invoked by every package's `typecheck`
 * script — and not a hole: a per-importer entry still applies to that importer alone.
 *
 * @param {ParsedLockfile} parsed
 * @param {string} source Every source file's text, concatenated.
 * @param {Record<string, string[]>} exemptions Dependency names to ignore, per importer,
 *   with `*` applying to all of them.
 * @param {string[]} documented Names a human has recorded as deliberately unused, each
 *   with its reason in the baseline. Exempt here, and checked by the test that every
 *   such exemption is still actually unused — so an entry cannot outlive the reason
 *   for it and quietly become a place to hide a regression.
 * @param {string} configuration Configuration files' text, where a quoted package
 *   name is a reference and in application source it is not.
 * @returns {UnusedDependency[]}
 */
export function unusedDependencies(
  parsed,
  source,
  exemptions,
  documented = [],
  configuration = '',
) {
  const everywhere = new Set(exemptions['*'] ?? []);
  /** @type {Map<string, Set<string>>} */
  const byName = new Map();
  for (const [importer, groups] of Object.entries(parsed.importers)) {
    const exempt = new Set([...everywhere, ...(exemptions[importer] ?? [])]);
    for (const group of DEPENDENCY_GROUPS) {
      for (const name of Object.keys(groups[group])) {
        if (exempt.has(name)) continue;
        if (isReferenced(name, source, configuration)) continue;
        const importers = byName.get(name);
        if (importers) importers.add(importer);
        else byName.set(name, new Set([importer]));
      }
    }
  }

  const documentedNames = new Set(documented);
  return [...byName.entries()]
    .filter(([name]) => !documentedNames.has(name))
    .map(([name, importers]) => ({ name, declaredIn: [...importers].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Compare what the tree resolved against what a human recorded.
 *
 * All three directions matter, and the third is the one a ratchet usually forgets:
 * a row left behind by a deliberate deletion is drift too, because a baseline that
 * only ever grows becomes a list of history rather than a statement about the tree.
 *
 * @param {Record<string, string>} resolved Package name to resolved version, links
 *   excluded by the caller.
 * @param {unknown} baseline The parsed contents of `dependency-baseline.json`. Typed
 *   as `unknown` rather than as a shape, because the file is read from disk and the
 *   point of this function is to refuse a file it cannot read — a parameter typed as
 *   the shape it expects would let a wrong file through type checking and fail only
 *   here, at runtime, on a gate.
 * @returns {VersionDrift}
 */
export function compareResolvedToBaseline(resolved, baseline) {
  const parsed = /** @type {Record<string, unknown>} */ (
    typeof baseline === 'object' && baseline !== null ? baseline : {}
  );
  const entries = parsed.entries;
  if (!Array.isArray(entries)) {
    throw new Error(
      'deps-policy: the dependency baseline has no `entries` array. A baseline that ' +
        'reads as empty would report no drift at all, which is the fail-open direction: ' +
        'restore docs/quality/dependency-baseline.json rather than bypassing this check.',
    );
  }

  /** @type {BaselineEntry[]} */
  const recorded = [];
  for (const entry of entries) {
    const row = /** @type {Record<string, unknown>} */ (
      typeof entry === 'object' && entry !== null ? entry : {}
    );
    if (typeof row.name !== 'string' || typeof row.version !== 'string') {
      throw new Error(
        `deps-policy: baseline row ${JSON.stringify(entry)} is missing a name or a version. ` +
          'Every row has to name the package and the exact version a human reviewed.',
      );
    }
    recorded.push({ name: row.name, version: row.version });
  }

  /** @type {Record<string, string>} */
  const reviewed = {};
  for (const entry of recorded) reviewed[entry.name] = entry.version;

  const unreviewed = Object.entries(resolved)
    .filter(([name]) => !(name in reviewed))
    .map(([name, version]) => ({ name, version }));
  const stale = recorded
    .filter((entry) => !(entry.name in resolved))
    .map((entry) => ({ name: entry.name, version: entry.version }));
  const changed = recorded
    .filter((entry) => entry.name in resolved && resolved[entry.name] !== entry.version)
    .map((entry) => ({
      name: entry.name,
      reviewed: entry.version,
      resolved: resolved[entry.name],
    }));

  const byName = (/** @type {{ name: string }} */ left, /** @type {{ name: string }} */ right) =>
    left.name.localeCompare(right.name);
  return {
    unreviewed: unreviewed.sort(byName),
    stale: stale.sort(byName),
    changed: changed.sort(byName),
  };
}

/**
 * The contiguous run of comment lines immediately above a line.
 *
 * @param {string[]} lines
 * @param {number} index
 * @returns {string}
 */
function commentRunAbove(lines, index) {
  /** @type {string[]} */
  const run = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];
    if (!line.trim().startsWith('#')) break;
    run.unshift(line);
  }
  return run.join('\n');
}

/**
 * The contiguous run of comment lines immediately below a line.
 *
 * @param {string[]} lines
 * @param {number} index
 * @returns {string}
 */
function commentRunBelow(lines, index) {
  /** @type {string[]} */
  const run = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line.trim().startsWith('#')) break;
    run.push(line);
  }
  return run.join('\n');
}

/**
 * The review date a comment run claims, if it claims one.
 *
 * The date is normalised before it is matched, and that is not tidiness. The real
 * file wraps its own provenance mid-sentence:
 *
 * ```
 * # GHSA-7fh5-64p2-3v2j (browserslist ReDoS) in 4.28.2 and earlier. Reviewed
 * # 2026-06-30.
 * 'browserslist@4.28.2': 4.28.7
 * ```
 *
 * So `Reviewed` and the date it introduces sit on **different lines**, separated by a
 * comment marker. A regex that does not strip `#` first finds no date there and
 * reports a reviewed override as having no provenance — the one answer that is wrong
 * in the direction that looks like a defect.
 *
 * @param {string} documented
 * @returns {string | null}
 */
function reviewDate(documented) {
  const flattened = documented.replaceAll('#', ' ').replaceAll(/\s+/g, ' ');
  const reviewed = /Reviewed\s+(\d{4}-\d{2}-\d{2})/.exec(flattened);
  return reviewed ? reviewed[1] : null;
}

/**
 * Overrides whose review date has arrived, or that carry no review date at all.
 *
 * `pnpm-workspace.yaml` states the rule in its own header: an override with no
 * provenance applies forever and silently masks the next parent bump, and a review
 * date that arrives is a trigger to re-check the advisory. Both halves are checked
 * here, because both are the same defect wearing different clothes.
 *
 * The comment documenting an override is written above it in the real file and below
 * it in some others, so both runs are read. Reading only one direction would find no
 * dates where there are dates and report every override as having no provenance.
 *
 * @param {string} text The `pnpm-workspace.yaml` contents.
 * @param {string} today ISO date, so the caller controls the clock.
 * @returns {OverrideReview[]}
 */
export function expiredOverrideReviews(text, today) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'overrides:');
  if (start === -1) return [];

  /** @type {OverrideReview[]} */
  const expired = [];
  let sawKey = false;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    // The block ends at the next top-level key, which in the real file is `catalog:`.
    if (line.trim() !== '' && !/^\s/.test(line)) break;

    // An override key sits at indent 2 and carries its value on the same line, so it
    // does not end in a colon — the same shape as `'ajv@8.20.0>fast-uri': 3.1.7`. A
    // comment in the same position is not a key.
    const key = /^ {2}(?:'[^']*'|[^:]+):/.exec(line);
    if (!key || line.trim().startsWith('#')) continue;

    sawKey = true;
    const override = unquote(key[0].trim().slice(0, -1));
    const documented = `${commentRunAbove(lines, index)}\n${commentRunBelow(lines, index)}`;
    const reviewedOn = reviewDate(documented);

    // No provenance is reported for the same reason a past date is: an override
    // nobody re-checked is an override nobody is looking after.
    if (reviewedOn === null || reviewedOn < today) expired.push({ override, reviewedOn });
  }

  if (!sawKey && text.includes('overrides:')) {
    throw new Error(
      'deps-policy: an `overrides:` key with no entries under it. The real file has seven, ' +
        'so this is a layout this parser does not understand, and reading it as "no ' +
        'overrides to review" would pass the check that matters most.',
    );
  }

  return expired;
}
