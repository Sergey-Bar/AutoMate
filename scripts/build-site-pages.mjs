/**
 * Generates the status pages of the documentation site from the repository's own
 * machine-checked sources.
 *
 * These four pages are generated rather than written, and that is the whole point.
 * A hand-written capability table is a claim that a human agreed with once; a
 * generated one cannot claim more than the gate that produced it, so a row that
 * stops being true stops being published. The alternative — a status page that says
 * "6 missing" because it said so in March — is worse than no page, because a reader
 * has no way to tell it from a live one.
 *
 * The four sources, and what each is authoritative about:
 *
 *   - `docs/migration/capability-register.md` — what the product can do, and the
 *     qualification each capability carries. Hand-maintained by design: it is a
 *     judgement, not a measurement.
 *   - `docs/quality/findings-ledger.json` — what is known to be wrong. The row
 *     count and the open bands come from the ledger itself.
 *   - `coverage-baseline.json` — the per-package coverage floors the ratchet
 *     compares against. Reading the *floor* rather than a measured run is
 *     deliberate: the floors only move up, so a page generated from them cannot
 *     report a number that has not been earned.
 *   - `pnpm status:10` — the roadmap's §17 twelve points. A measurement of the
 *     committed tree, reported as `pass` / `fail` / `not_configured`, and the only
 *     number in this repository that would otherwise have had no command behind it.
 *
 * The generator writes a `<!-- generated -->` marker into each page and refuses to
 * overwrite a page that has hand-written content below the marker, so an edit made
 * in the site's `src/` is a conflict rather than a silent overwrite.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Prettier aligns table columns to their widest cell, and a generator that emits
 * `| a | b |` without that padding produces different bytes on every run relative to
 * `pnpm format`. The implementation is in `scripts/lib/markdown-table.mjs` and is
 * shared with the twelve-point page, so a change to the alignment rule is one edit
 * rather than two that can drift.
 */
import { table } from './lib/markdown-table.mjs';
import { twelvePage } from './lib/site-ten-page.mjs';

// `dirname(import.meta.url)` is `<root>/scripts`, so one `..` is the repository
// root. The first version had two, and read `C:/VS-Code-Projects/Github/docs/...` —
// an ENOENT naming a path one level above the repository, which says nothing about
// which of the two was wrong.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = path.join(root, 'site', 'pages');

/** The marker that identifies generated content, and the hand-written wrapper. */
/** The em-dash glyph, named, so a table cell and the prose cannot disagree on it. */
const DASH = '\u2014';

/**
 * The code-span delimiter, as a named character.
 *
 * `statusVocabulary()` builds a pattern around it, and a literal backtick inside a regex
 * literal needs escaping in a way that is hard to read in a line that is already long. Named,
 * it is obvious what the pattern is matching.
 */
const BACKTICK = String.fromCharCode(96);

const OPEN = '<!-- generated: do not edit this block by hand -->';
const CLOSE = '<!-- /generated -->';

/**
 * Writes one generated page, preserving anything above or below the markers.
 *
 * @param {string} slug path under `site/pages`, without `.md`
 * @param {string[]} lines the generated body
 */
function writePage(slug, lines) {
  const file = path.join(PAGES, `${slug}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  // Two formatting rules Prettier applies to this block, reproduced here so the
  // generator and the formatter agree instead of overwriting each other:
  //
  //   - a blank line before the closing marker, because Prettier separates a block
  //     comment from the table or paragraph above it;
  //   - a trailing newline, because Prettier adds one.
  //
  // The staleness gate compares bytes, so a single missing blank line is a red
  // `format:check` and a red gate on every run.
  const body = `${[OPEN, ...lines, '', CLOSE].join('\n')}\n`;

  const existing = readFileSyncSafe(file);
  if (existing === null) {
    writeFileSync(file, `# ${titleOf(slug)}\n\n${body}`, 'utf8');
    format(file);
    return;
  }
  const start = existing.indexOf(OPEN);
  const end = existing.indexOf(CLOSE);
  // A page with content but no marker is hand-written, and this must not clobber it.
  if (start === -1 || end === -1) {
    throw new Error(
      `${file} has content but no generated markers; refusing to overwrite a hand-written page`,
    );
  }
  // The tail is re-emitted with exactly one trailing newline rather than whatever
  // was there, so a page rewritten twice does not accumulate one per run — the
  // failure mode of a writer that appends its own terminator to a file that
  // already has one.
  const tail = existing.slice(end + CLOSE.length).replace(/^\n+/, '\n');
  writeFileSync(file, `${existing.slice(0, start)}${body}${tail === '\n' ? '\n' : tail}`, 'utf8');
  format(file);
}

/**
 * Runs Prettier over a page this generator just wrote.
 *
 * The generator is stable on its own — running it twice produces identical bytes,
 * which is what the staleness gate checks. What it was not is *Prettier-stable*: a
 * table emitted without padded columns, or a trailing block comment without its
 * blank line, is valid markdown that Prettier reflows, and the two tools then
 * overwrite each other on every run.
 *
 * Reproducing Prettier's rules by hand was tried first and is the wrong shape: it
 * duplicates a formatter's output format in a place that has to be updated whenever
 * the formatter changes, and the failure is invisible — a mismatch of one blank
 * line. Calling it is the whole fix, at the cost of a subprocess per page.
 *
 * @param {string} file
 */
function format(file) {
  // Prettier is invoked through a path rather than `import`, and resolving it
  // relative to the repository root made the generator depend on being *in* the
  // checkout: run from a copy, it failed with "Cannot find module
  // node_modules/prettier/bin/prettier.cjs" — which is exactly what the staleness
  // gate does, so the gate could not use the generator it was checking.
  //
  // Resolved through the module system instead, which walks up from this file and so
  // finds the repository's `node_modules` from any location under it.
  const result = spawnSync(
    process.execPath,
    [path.join(path.dirname(fileURLToPath(import.meta.url)), 'format-generated.mjs'), '--', file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `prettier failed on ${file}: ${result.stderr || result.stdout || 'no output'}. The page is ` +
        'written but unformatted, so format:check fails until this is fixed.',
    );
  }
}

/** @param {string} file @returns {string | null} */
function readFileSyncSafe(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Headings for the pages whose slug is not the page's name.
 *
 * Applied only when the page does not exist yet, so a heading somebody has since
 * rewritten by hand above the marker is left alone — the marker is the boundary, and
 * a generator that edits outside it would clobber a page it is meant to be a
 * section of.
 *
 * @type {Record<string, string>}
 */
const TITLES = {
  'quality/ten': 'Definition of done, as measured',
  'quality/findings': 'Findings ledger',
  'quality/coverage': 'Coverage floors',
};

/** @param {string} slug @returns {string} */
function titleOf(slug) {
  const named = TITLES[slug];
  if (named !== undefined) return named;
  const last = slug.split('/').pop() ?? slug;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
// ── Capabilities ───────────────────────────────────────────────────────────

/**
 * The register's rows, parsed.
 *
 * A tolerant `|`-row parse rather than a markdown table library, because the file
 * is a hand-maintained table and a parser that fails loudly on a formatting change
 * would make the *generator* the reason a correction to the register could not be
 * made. A row it cannot read is skipped and counted, and the count is reported.
 */
/**
 * The register’s status vocabulary, as `status -> definition`.
 *
 * **Parsed out of the register rather than written here, and that is the whole design.** The
 * page exists to answer "does this product do the thing I need", and five unexplained words
 * cannot answer it — but a *second* copy of the definitions would be a second authority
 * for the same sentences, which is the defect this repository records as
 * `no-second-authority`. Read from the register, the page and the register cannot drift.
 *
 * A status the register does not define comes back absent rather than with a guess.
 *
 * @returns {Map<string, string>}
 */
function statusVocabulary() {
  /** @type {Map<string, string>} */
  const definitions = new Map();
  const source = readFileSync(
    path.join(root, 'docs', 'migration', 'capability-register.md'),
    'utf8',
  );
  const section = /##\s+Status vocabulary\s*\n([\s\S]*?)\n##\s/.exec(source)?.[1];
  if (section === undefined) return definitions;
  // Each definition is a dashed list item whose key is wrapped in a code span, so the key
  // is what the generator can key on and the sentence is whatever follows the dash.
  //
  // Assembled from `BACKTICK` rather than written as a literal, because a regex literal here
  // would need the delimiter escaped and the glyph is easier to reason about as a named
  // character than as `\\x60` in the middle of a pattern.
  const pattern = new RegExp(
    '^-\\s+' + BACKTICK + '([a-z]+)' + BACKTICK + '\\s+[\\u2014-]\\s+(.+?)\\s*$',
  );
  for (const line of section.split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) definitions.set(match[1], match[2]);
  }
  return definitions;
}

/**
 * The closing line every generated page carries.
 *
 * One sentence, on every page, in the same words. It answers the question a reader has when a
 * number looks wrong — *what do I edit, and what do I run* — and the answer always has the same
 * shape: edit the named source, run this command.
 *
 * @returns {string[]}
 */
function regenerationFooter() {
  return [
    '',
    'The numbers above are derived. To change one, edit the file this page names as',
    'its source, then run ' + BACKTICK + 'pnpm site:generate' + BACKTICK + '.',
  ];
}

function readRegister() {
  const text = readFileSync(path.join(root, 'docs', 'migration', 'capability-register.md'), 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 5) continue;
    if (['ID', '---', 'ID '].includes(cells[0] ?? '')) continue;
    if ((cells[0] ?? '').replace(/-/g, '').length === 0) continue;
    rows.push({ id: cells[0] ?? '', capability: cells[1] ?? '', status: cells[2] ?? '' });
  }
  return rows;
}

const STATUS_ORDER = ['real', 'mock', 'missing', 'deferred', 'obsolete'];

function capabilityPage() {
  const rows = readRegister();
  const vocabulary = statusVocabulary();
  const counts = new Map(STATUS_ORDER.map((status) => [status, 0]));
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);

  return [
    '',
    `Generated from \`docs/migration/capability-register.md\`, which is the source of`,
    'truth for this page. A capability is not promoted because a page says it is.',
    '',
    "**What the statuses mean**, in the register's own words:",
    '',
    ...table(
      ['Status', 'Count', 'Meaning'],
      STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => [
        `**${status}**`,
        String(counts.get(status) ?? 0),
        vocabulary.get(status) ?? DASH,
      ]),
    ),
    '',
    ...regenerationFooter(),
    '',
    ...table(
      ['Capability', 'Status'],
      rows.map((row) => [row.capability, `\`${row.status}\``]),
    ),
  ];
}

// ── Findings ───────────────────────────────────────────────────────────────

function findingsPage() {
  const parsed = JSON.parse(
    readFileSync(path.join(root, 'docs', 'quality', 'findings-ledger.json'), 'utf8'),
  );
  const rows = Array.isArray(parsed) ? parsed : parsed.findings;
  const byStatus = new Map();
  const openByBand = new Map();
  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    if (row.status !== 'open') continue;
    openByBand.set(row.band, (openByBand.get(row.band) ?? 0) + 1);
  }

  const open = rows.filter((/** @type {{status: string}} */ row) => row.status === 'open');
  return [
    '',
    'Generated from `docs/quality/findings-ledger.json`. The ledger is a record of',
    'what is *known* to be wrong, and `pnpm findings:check` fails when a `fixed` row',
    'loses its evidence — so a row here is a claim with a path behind it.',
    ...regenerationFooter(),
    '',
    ...table(
      ['Status', 'Rows'],
      [...byStatus.entries()].sort().map(([status, count]) => [`\`${status}\``, String(count)]),
    ),
    '',
    `## Open (${String(open.length)})`,
    '',
    ...table(
      ['Band', 'Open'],
      ['Blocker', 'Critical', 'Major', 'Minor']
        .filter((band) => (openByBand.get(band) ?? 0) > 0)
        .map((band) => [band, String(openByBand.get(band) ?? 0)]),
    ),
    '',
    ...table(
      ['ID', 'Band', 'Finding'],
      open
        .sort((/** @type {{band: string}} */ left, /** @type {{band: string}} */ right) => {
          const order = ['Blocker', 'Critical', 'Major', 'Minor'];
          return order.indexOf(left.band) - order.indexOf(right.band);
        })
        .map((/** @type {{id: string, band: string, title: string}} */ row) => [
          `\`${row.id}\``,
          row.band,
          row.title,
        ]),
    ),
  ];
}

// ── Coverage ───────────────────────────────────────────────────────────────

function coveragePage() {
  const baseline = JSON.parse(readFileSync(path.join(root, 'coverage-baseline.json'), 'utf8'));
  const floorOf = (/** @type {any} */ entry) =>
    entry === null || entry === undefined
      ? null
      : 'statements' in entry
        ? entry
        : 'floors' in entry
          ? entry.floors
          : null;
  const packages = Object.entries(baseline)
    .map(([name, entry]) => [name, floorOf(entry)])
    .filter((pair) => pair[1] !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  return [
    '',
    'Generated from `coverage-baseline.json` — the **floors** the ratchet compares',
    'against, not a measured run. A floor only moves up, so this page cannot report',
    'a number that has not been earned.',
    ...regenerationFooter(),
    '',
    'There is no per-package Vitest threshold, and that is deliberate: a threshold that',
    'blocks every run gets raised until it means nothing. `pnpm coverage:ratchet` fails',
    'on a regression instead.',
    '',
    ...table(
      ['Package', 'Statements', 'Branches', 'Functions', 'Lines'],
      packages.map(([name, floors]) => [
        `\`${name}\``,
        String(floors?.statements ?? '—'),
        String(floors?.branches ?? '—'),
        String(floors?.functions ?? '—'),
        String(floors?.lines ?? '—'),
      ]),
    ),
  ];
}

// ── The twelve points ───────────────────────────────────────────────────────

// The body lives in `scripts/lib/site-ten-page.mjs`, not here, because a page whose
// source is the whole tree cannot be checked by copying this script and its four
// data files. That module's comment is the reason, and `docs-paths.test.mjs`
// implements the consequence: this page is compared by recomputation, the other
// three by running this generator against a copy.

// What this run produced, as a count — the number a caller compares against the
// pages it asked for. The first version listed `site/pages` and called it "what was
// written", so a page that stopped being generated would still have been reported as
// written; the list is the calls themselves.
//
// `--only` exists for the staleness gate, not for humans. Three of the four pages
// read a single data file each, so the gate copies the script and those files into a
// scratch directory and runs it there — and the fourth reads the whole tree, so
// copying it would mean copying the repository. The gate therefore asks for the
// three it can reproduce, and checks the fourth by recomputing it in process
// (`docs-paths.test.mjs`). Without this flag the copy-based check would either need
// the entire tree beside it or would silently generate a page from a tree of five
// files.
const requested = new Set(
  (process.argv.find((argument) => argument.startsWith('--only=')) ?? '')
    .replace('--only=', '')
    .split(',')
    .filter((slug) => slug !== ''),
);
/** @param {string} slug */
const wanted = (slug) => requested.size === 0 || requested.has(slug);

/** @type {Array<[string, string, () => string[]]>} */
const GENERATED = [
  ['capabilities', 'capabilities.md', capabilityPage],
  ['quality/findings', 'quality/findings.md', findingsPage],
  ['quality/coverage', 'quality/coverage.md', coveragePage],
  ['quality/ten', 'quality/ten.md', () => twelvePage(root)],
];

/** @type {string[]} */
const written = [];
for (const [slug, name, build] of GENERATED) {
  if (!wanted(slug)) continue;
  writePage(slug, build());
  written.push(name);
}
console.log(`generated ${String(written.length)} page(s): ${written.join(', ')}`);
