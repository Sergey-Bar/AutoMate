import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** The repository root, for the committed data file this suite also reads. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The generator, the pages it writes, and the three sources it reads. */
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-site-pages.mjs');
const FORMATTER = path.join(REPO_ROOT, 'scripts', 'format-generated.mjs');
const SITE_PAGES = path.join(REPO_ROOT, 'site', 'pages');
const REGISTER = path.join(REPO_ROOT, 'docs', 'migration', 'capability-register.md');
const LEDGER = path.join(REPO_ROOT, 'docs', 'quality', 'findings-ledger.json');
const BASELINE = path.join(REPO_ROOT, 'coverage-baseline.json');

/**
 * Documentation a person reads to decide whether to trust this product.
 *
 * `unified-repository-migration.md` is **excluded**, and that is a decision worth
 * stating rather than a gap.
 *
 * It is the plan of record for a merge that has already happened, so most of its
 * citations name the repository this one was merged *from* — `src/engine/…`,
 * `perf/…`, `apps/server/…` — and they are correctly absent here. Scoping it by
 * prefix would have meant guessing at the source repository's shape, and a wrong
 * guess either hides real defects or reports the whole document.
 *
 * It is not unexamined. The two citations it carried that were wrong about *this*
 * repository — three references to an `orchestrator/chat.ts` that never existed
 * here, and whose surrounding claim ("deterministic mocks") had itself gone stale
 * — were corrected to point at `packages/automation/src/ai-gateway.ts` and its
 * adapters. What remains exempt is only the past-tense half.
 */
const DOCS = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];

/**
 * Documents whose claims are about a repository this one no longer contains.
 *
 * Declared before the plan list that uses it: a `const` read from a function that
 * runs at module scope hits the temporal dead zone, and the error names the line
 * that read it rather than the line that declared it.
 */
const HISTORICAL_DOCS = ['1790276458882-unified-repository-migration.md'];

/**
 * The plans under `.kilo/`, which are documentation too.
 *
 * One of them carried the claim that became ledger row RF-12: "`vitest-axe` is
 * declared and unused", reasoning from there toward removing a package that two
 * suites depend on. A plan is read by the next person exactly as a README is, and
 * the only thing that made the difference feel safe was that a plan looks like a
 * record rather than a description. So the plans are checked for the unused-claim
 * form below, and for the same reason.
 *
 * `HISTORICAL_DOCS` is exempt for the reason the paragraph above this list gives.
 */
const PLAN_DOCS = planFiles();

/** @returns {string[]} repository-root-relative paths of the plans that are checked. */
function planFiles() {
  const directory = path.join(REPO_ROOT, '.kilo', 'plans');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => !HISTORICAL_DOCS.includes(name))
    .sort()
    .map((name) => `.kilo/plans/${name}`);
}

/**
 * Every backticked token in a document that cites a source file.
 *
 * Narrow on purpose. A first pass accepted any backticked token containing a `/`
 * and produced 30 findings, almost all of them things a document is *allowed* to
 * name without them existing: a package name (`@automate/db`), a lint rule
 * (`@typescript-eslint/no-explicit-any`), a URL path (`/api/v1`), and a bare
 * directory relative to whichever package the reader is in (`src/`). A gate that
 * cries wolf is switched off, and this one would have been.
 *
 * So: a token must carry a source-file extension. That is exactly the shape of
 * both real defects — `src/routes/chat.test.ts` and
 * `apps/api/src/modules/orchestrator/chat.ts` — and it is the shape a reader
 * would try to open.
 *
 * @param {string} text
 * @returns {string[]} sorted, de-duplicated
 */
function citedPaths(text) {
  const found = new Set();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const token = (span[1] ?? '').trim();
    // Trailing `path:38-113` and `,` are citations of a place, not of a token.
    const citation = token.replace(/:[\d, -]+$/, '').replace(/[.,;:]$/, '');
    if (!isSourceFileCitation(citation)) continue;
    // A single segment is a basename, and this suite cannot tell which package a
    // reader means by it — `host-scanners.test.mjs` lives in `scripts/lib`, the
    // same token in another document could mean something else. Not checked.
    if (!citation.includes('/')) continue;
    // A scoped package name is a dependency, not a path in this repository.
    if (citation.startsWith('@')) continue;
    // `pnpm --filter x exec vitest run src/x.ts` arrives as one token with spaces.
    if (/\s/.test(citation)) continue;
    found.add(citation);
  }
  return [...found].sort();
}

/**
 * A relative path that names a file this repository would contain.
 *
 * `.mjs`/`.cjs` are included and plain `.js` is **not**: a document may name
 * `dist/index.js` as build output, but a `.mjs` in this repository is always a
 * source gate script that exists. `no-console`'s own reasoning applies — a gate
 * is worth checking, an artefact is not.
 */
const EXTENSION = /\.(?:[cm]?tsx?|ya?ml|mjs|cjs)$/;

/**
 * One path segment: letters, digits, dot, dash, underscore.
 *
 * A leading dot is allowed because `.github/workflows/unified-ci.yml` is the most
 * frequently cited file in the security rules, and a rule that could not check the
 * file it exists to protect would be worse than useless.
 */
const SEGMENT = /^\.?[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Whether a token is a citation of a source file in this repository.
 *
 * Written as three separate checks rather than one pattern. The single-regex
 * version needed a nested quantifier over an overlapping character class — the
 * shape `security/detect-unsafe-regex` flags, and correctly: it was ambiguous
 * about where one segment ended and the next began. Splitting it says the same
 * thing in a form that cannot backtrack badly.
 *
 * @param {string} token
 */
function isSourceFileCitation(token) {
  if (!EXTENSION.test(token)) return false;
  // A leading `./` or `../` is a spelling, not a difference.
  const body = token.replace(/^\.{1,2}\//, '');
  // Every segment must be a plausible name, which is what rules out a URL path,
  // a package name, and prose that happens to end in something.
  return body.split('/').every((segment) => SEGMENT.test(segment));
}

/** Every file under the repository root, as `/`-separated relative paths. */
/** @type {string[] | null} */
let allFiles = null;
function files() {
  if (allFiles !== null) return allFiles;
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(REPO_ROOT, full).replaceAll('\\', '/'));
    }
  };
  walk(REPO_ROOT);
  allFiles = found;
  return allFiles;
}

/**
 * Whether a citation names something that exists.
 *
 * Two readings, because the documents use two. An absolute-from-root path is
 * checked as written; a path relative to whichever package the reader is in
 * (`src/errors/boundary.ts` in `AGENTS.md`, which is all of `apps/api`) is
 * checked as a suffix. The second is what makes the check usable on the
 * conventions sections, which write paths the way a developer types them.
 *
 * @param {string} relative
 */
function resolves(relative) {
  const clean = relative.replace(/^\.\//, '');
  return files().some(
    /** @param {string} file */ (file) => file === clean || file.endsWith(`/${clean}`),
  );
}

test('the documentation exists, so the checks below are about drift and not absence', () => {
  // A scan over a missing file reads as a clean repository. This keeps the next
  // assertions from passing on nothing.
  for (const doc of DOCS) {
    const full = path.join(REPO_ROOT, doc);
    assert.ok(
      existsSync(full) && readFileSync(full, 'utf8').length > 0,
      `${doc} is missing or empty; every drift check below would pass vacuously`,
    );
  }
});

test('the cited path check reaches the documents it claims to', () => {
  // A detector that finds nothing is indistinguishable from clean documents, and
  // the two real defects were invisible for exactly that reason.
  assert.deepEqual(citedPaths('`apps/api/src/routes/chat.test.ts`'), [
    'apps/api/src/routes/chat.test.ts',
  ]);
  assert.deepEqual(citedPaths('`packages/config/src/config.ts` is the source.'), [
    'packages/config/src/config.ts',
  ]);
  // A line range is a citation of a place, and resolves against the file.
  assert.deepEqual(citedPaths('see `.github/workflows/unified-ci.yml:38-113` for the job'), [
    '.github/workflows/unified-ci.yml',
  ]);
  // So is a plain workflow path, which is how the security rules name one.
  assert.deepEqual(citedPaths('`actions/install-scanners/action.yml` installs them'), [
    'actions/install-scanners/action.yml',
  ]);

  // And the shapes a document is allowed to name without them existing. Each of
  // these was a false positive in the first pass, and a gate that reports them
  // gets switched off rather than refined.
  assert.deepEqual(
    citedPaths(
      [
        '`@automate/shared-contracts` is a package',
        '`@typescript-eslint/no-explicit-any` is a rule',
        '`/api/v1/agents` is a route',
        '`src/` is relative to the package',
        '`apps/web/src/store/` is a directory that must not exist',
        '`dist/index.js` is build output',
        '`**/dist` is a glob',
        '`pnpm --filter x test` is a command',
        '`statements/branches` is prose',
      ].join(' '),
    ),
    [],
  );
});

test('no site navigation entry points at a page that does not exist', () => {
  // VitePress does not validate `themeConfig` links, so a nav entry pointing at an
  // unwritten page builds green and ships a 404. The first version of the site had
  // seven of them, which is how a stub site starts making claims it cannot back.
  //
  // Checked against the *page files* rather than the build output, so it runs
  // without building and fails on the commit that introduced the dangling link
  // rather than on the next deploy.
  const config = readFileSync(path.join(REPO_ROOT, 'site', '.vitepress', 'config.mts'), 'utf8');
  const links = [...config.matchAll(/link:\s*'([^']+)'/g)].map((match) => match[1] ?? '');
  assert.ok(links.length >= 6, `found only ${String(links.length)} nav links; this is vacuous`);

  const missing = links
    // `/` is the home page, which is `site/index.md`.
    .filter((link) => link !== '/')
    .filter((link) => {
      const page = link.replace(/^\//, '').replace(/\/$/, '');
      return !existsSync(path.join(REPO_ROOT, 'site', `${page}.md`));
    });
  assert.deepEqual(
    missing,
    [],
    `site nav points at pages that do not exist: ${missing.join(', ')}`,
  );
});

test('the generated status pages are current, or a reader is reading a stale claim', () => {
  // The three status pages are generated from machine-checked sources so they cannot
  // claim more than the gates prove. That guarantee has one failure mode: the
  // generator stops running and the committed pages go on being read as live.
  //
  // **Read-only, and that is the whole point.** The first version ran the generator
  // and then compared, which regenerated the very files it was checking — so the
  // check passed whatever the committed state was, and a failure left a modified
  // working tree behind. In docs.yml it was worse: the workflow ran
  // pnpm site:generate *before* pnpm docs:check, so the check was satisfied by
  // construction and its own step comment was false.
  //
  // The comparison is therefore made against a copy. The generator resolves its
  // output directory from its own location, so a copy of the script and of the pages
  // is what gets run — which is what makes the whole thing read-only, because
  // nothing writes back into the checkout.
  // Inside the repository, under `node_modules/.cache`, for two reasons.
  //
  // `node_modules` is already git-ignored, so the copy is never a working-tree
  // change — which is the property this check exists to have. And the generator
  // resolves Prettier through the module system, which walks *up* from the running
  // script: a copy under the OS temp directory cannot find it, because
  // `C:\Users\...\Temp` is not below this repository and the walk ends at the drive
  // root. The first attempt used `mkdtemp(os.tmpdir())` and failed with "Cannot find
  // module 'prettier/bin/prettier.cjs'" — a check that cannot run is a check that
  // passes for the wrong reason.
  const temporary = mkdtempSync(path.join(REPO_ROOT, 'node_modules', '.cache', 'site-stale-'));
  try {
    mkdirSync(path.join(temporary, 'scripts'), { recursive: true });
    mkdirSync(path.join(temporary, 'site'), { recursive: true });
    copyFileSync(SCRIPT, path.join(temporary, 'scripts', 'build-site-pages.mjs'));
    // The generator shells out to its formatter by name, so the copy needs it too —
    // and because that one resolves Prettier through the module system, the copy
    // still finds the installed package by walking up from itself.
    copyFileSync(FORMATTER, path.join(temporary, 'scripts', 'format-generated.mjs'));
    copyTree(SITE_PAGES, path.join(temporary, 'site', 'pages'));
    // The generator reads the register, the ledger and the baseline, so a copy of
    // those has to sit beside it or the copy is not a faithful reproduction.
    mkdirSync(path.join(temporary, 'docs', 'migration'), { recursive: true });
    mkdirSync(path.join(temporary, 'docs', 'quality'), { recursive: true });
    copyFileSync(REGISTER, path.join(temporary, 'docs', 'migration', 'capability-register.md'));
    copyFileSync(LEDGER, path.join(temporary, 'docs', 'quality', 'findings-ledger.json'));
    copyFileSync(BASELINE, path.join(temporary, 'coverage-baseline.json'));

    const output = runGeneratorIn(temporary);

    const stale = ['capabilities.md', 'findings.md', 'coverage.md'].filter((name) => {
      const relative = name === 'capabilities.md' ? name : 'quality/' + name;
      const produced = path.join(temporary, 'site', 'pages', relative);
      // A page the generator did not produce at all is stale in the strongest way.
      if (!existsSync(produced)) return true;
      return (
        readFileSync(path.join(SITE_PAGES, relative), 'utf8') !== readFileSync(produced, 'utf8')
      );
    });

    assert.deepEqual(
      stale,
      [],
      'these generated pages are stale; run pnpm site:generate and commit the result: ' +
        stale.join(', ') +
        '. The generator produced: ' +
        output.trim() +
        '. The working tree was not modified.',
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

/**
 * Copies a directory tree.
 *
 * `copyFileSync` does not take a directory, and `fs.cpSync` would have worked — this
 * exists so the only thing the staleness check needs from `node:fs` is `readFileSync`
 * and the handful of writers the copy itself uses.
 *
 * @param {string} from source directory
 * @param {string} to   destination directory
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}

/**
 * Runs the copied generator, which resolves its output from its own location.
 *
 * @param {string} workingDirectory a directory holding scripts/, site/pages/ and the three data files
 * @returns {string} the generator's stdout
 */
function runGeneratorIn(workingDirectory) {
  const result = spawnSync(
    process.execPath,
    [path.join(workingDirectory, 'scripts', 'build-site-pages.mjs')],
    {
      cwd: workingDirectory,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, 'site:generate failed against the copy: ' + result.stderr);
  return result.stdout;
}

test('no document calls something unused while the workspace still imports it', () => {
  // The general form of two ledger rows, and the durable fix RF-12 asks for.
  //
  // A superseded plan recorded `vitest-axe` as "declared and unused" and reasoned
  // from there toward replacing it. It is used, in two packages, through
  // `expectNoBlockingAxeViolations` — so the note was handing the next reader a
  // documented reason to delete working accessibility infrastructure. Nothing was
  // broken; the risk was entirely in the reader.
  //
  // So: a document that calls a named thing unused, deprecated, or dead, while the
  // workspace still imports it, is a false claim about this repository. A gate
  // catches the next one; a review note is what did not catch this one.
  //
  // Deliberately narrow about the phrasing, because a broad one produces noise and
  // a gate that cries wolf is switched off. The claim has to be a *named
  // identifier* next to a "not used" phrase.
  const UNUSED_CLAIM =
    /\b[a-z ]{0,12}?(?:unused|not used|never used|no longer used|dead|unreferenced|obsolete)\b/gi;

  const falseClaims = [];
  for (const doc of [...DOCS, ...PLAN_DOCS]) {
    // Quoted runs are removed *before* scanning, rather than each match being
    // checked for an enclosing quote.
    //
    // That is the honest reading of the rule: a claim written between quotation
    // marks is a *recorded* claim, whatever the distance between the quote and the
    // word. Decision D20 in the v2 plan is "`vitest-axe` stays in both packages",
    // justified by "v3 §8 Q4 says it is 'declared and unused'" — and three
    // implementations of the window approach each reported that refutation as the
    // claim it refutes, because the opening quote is several words from the word
    // being matched. A document must be able to write down what a superseded plan
    // wrongly said, or it cannot correct anything without tripping the gate.
    const text = readFileSync(path.join(REPO_ROOT, doc), 'utf8');
    // Struck-through text is removed for the same reason: a refutation is recorded
    // by striking the claim out, and it necessarily repeats the claim it strikes.
    const scannable = text.replace(/~~[^~]*~~/g, ' ').replace(/["“”'][\s\S]*?["“”']/g, ' ');
    // Matched in a short window *after* each identifier, not per paragraph.
    //
    // A paragraph-scoped version of this gate reported `AGENTS.md`'s own lint rule
    // — "Unused variables must be prefixed with `_`", with `` `any` `` in the same
    // paragraph — as a claim that `any` is unused. A claim has to be *about the
    // identifier*, so the phrase has to sit next to it rather than somewhere in the
    // same block of prose.
    for (const span of scannable.matchAll(/`([A-Za-z@][\w./@-]*)`/g)) {
      const name = span[1] ?? '';
      // A path is the other test's job; a bare identifier is a package or export.
      if (name.includes('/')) continue;
      const after = scannable.slice(span.index, span.index + span[0].length + 60);
      UNUSED_CLAIM.lastIndex = 0;
      const phrase = UNUSED_CLAIM.exec(after)?.[0]?.trim() ?? '';
      if (!phrase) continue;
      if (isImported(name)) {
        falseClaims.push(`${doc}: \`${name}\` is called ${phrase} but is imported`);
      }
    }
  }

  assert.deepEqual(
    falseClaims,
    [],
    `documents claiming live code is unused:\n${falseClaims.join('\n')}`,
  );
});

/**
 * Whether a bare name is used by anything other than its own test.
 *
 * @param {string} name
 */
function isImported(name) {
  const pattern = new RegExp(
    `from ['"][^'"]*\\b${escapeRegExp(name)}\\b|require\\(['"][^'"]*${escapeRegExp(name)}`,
  );
  // Test files are excluded on purpose, and a declaration is not a use.
  //
  // A component imported only by its own `Component.test.tsx` is not used by the
  // product — which is exactly what the first version of this gate got wrong:
  // `ThemeToggle` and `RunExplorer` are exported, rendered by their own tests, and
  // mounted by nothing, and counting the test as a use reported two *correct* claims
  // as false ones. A gate that reports the truth as false gets switched off, so this
  // one has to be right on the claims it does report.
  const declaring = new RegExp(
    `^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${escapeRegExp(name)}\\b`,
  );
  return sourceFiles()
    .filter((file) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
    .some((file) =>
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .some((line) => pattern.test(line) && !declaring.test(line.trim())),
    );
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every TypeScript/JavaScript source file the workspace could import from. */
function sourceFiles() {
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'coverage', '.turbo', '.git'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of ['apps', 'packages', 'tools', 'tests', 'scripts']) {
    walk(path.join(REPO_ROOT, root));
  }
  return found;
}

test('the unused-claim gate can see a claim, or it cannot fail', () => {
  // A detector that finds nothing is indistinguishable from a clean repository.
  // The two real cases, asserted directly, are the point of the whole test above.
  assert.match(
    '`vitest-axe` is declared and unused',
    /\b[a-z ]{0,12}?(?:unused|not used|never used|no longer used|dead|unreferenced|obsolete)\b/i,
    "the gate's phrase must match the claim that started this",
  );
  assert.ok(
    isImported('vitest-axe'),
    "vitest-axe is imported today, so the superseded plan's claim is false",
  );
  // And the plans are actually in scope — a gate over an empty list passes.
  assert.ok(
    PLAN_DOCS.length >= 2,
    `only ${String(PLAN_DOCS.length)} plan(s) checked; this is vacuous`,
  );
  assert.ok(
    PLAN_DOCS.some((plan) => plan.includes('merged-leftover-plan')),
    'the plan carrying the refuted claim must be among those checked',
  );
  // And a name nothing imports is not reported.
  assert.equal(isImported('a-package-nobody-imports'), false);
});

test('no document cites a path that does not exist', () => {
  // Neither of these was in a "planned" section, and both were in documents a
  // reader follows: `AGENTS.md` gave a single-file test command against a file
  // that did not exist, and the migration plan cited a module three times. A
  // reader following either was told to run something that cannot succeed.
  //
  // A gate rather than a review note, because the review note is what did not
  // catch either one.
  const missing = [];
  for (const doc of DOCS) {
    const text = readFileSync(path.join(REPO_ROOT, doc), 'utf8');
    for (const cited of citedPaths(text)) {
      if (resolves(cited)) continue;
      missing.push(`${doc}: \`${cited}\``);
    }
  }
  assert.deepEqual(missing, [], `cited paths that do not exist:\n${missing.join('\n')}`);
});
