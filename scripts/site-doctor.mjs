#!/usr/bin/env node
/**
 * `pnpm site:doctor` — the ten checks the public site has to pass before it ships.
 *
 * The roadmap's §17 twelfth point is "a public documentation site that is live, with a
 * timed quickstart, the capability table, an ADR index with no collision, and a
 * complete governance set — passing all ten `site-doctor` checks". Until this script
 * existed, "the ten site-doctor checks" was a list in a plan and the site had never been
 * deployed at all.
 *
 * **Ten checks, and a check that cannot run reports `GAP`, never a pass.** The roadmap's
 * own risk table states the rule: *"unimplemented checks report as `GAP` with what they
 * would need, never a silent pass"*, because a gate that always passes is this
 * repository's existing disease. So there are three outcomes — `pass`, `fail`, `GAP` —
 * and a `GAP` names the artefact it needs. Five of the ten need the **built** HTML, which
 * does not exist until `pnpm --filter @automate/docs build` has run; on a host where it
 * does not, those five say so rather than reporting clean.
 *
 * **What the blocking set is, and what is not.** The roadmap's risk table also says
 * *"visual/diff-style checks are excluded from the blocking set"* and *"external-link
 * checking runs on a schedule rather than every build"*. So there is no pixel check
 * here, and no check that reaches the network. Every check reads a file. A check that
 * needs the network is a check that fails on a firewall and gets switched off.
 *
 * The five source checks are the ones that carry the product's thesis: a page may not
 * type a number, may not claim a capability the register does not mark `real`, and may
 * not be a stale copy of a machine-checked source. The five DOM checks are the ones
 * that need a browser to be worth anything.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { collectDriftEnvironment, driftFindings, ASSERTIONS } from './lib/docs-drift.mjs';
import { twelvePage } from './lib/site-ten-page.mjs';
import { indexFiles } from './lib/status-ten.mjs';

/** The outcome vocabulary, and the third is not a pass. */
export const OUTCOMES = ['fail', 'GAP', 'pass'];

/** @typedef {'pass' | 'fail' | 'GAP'} Outcome */

/**
 * @typedef {object} Check
 * @property {number} number stable — the check is cited in commit messages and in the
 *   risk table, so renumbering one is a change to a vocabulary
 * @property {string} name
 * @property {Outcome} outcome
 * @property {string[]} problems
 * @property {string} note what a `GAP` needs, or a caveat on a `pass`
 */

const ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} relative @returns {string} */
function read(relative) {
  const full = path.join(ROOT, relative);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
}

/** @param {string} relative @returns {boolean} */
function has(relative) {
  return existsSync(path.join(ROOT, relative));
}

/** Every markdown page the site publishes, generated or not. */
function sitePages() {
  return indexFiles(ROOT)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => file.startsWith('site/'))
    .filter((file) => !file.startsWith('site/node_modules/'))
    .sort();
}

/**
 * The built site, if the caller says it is fresh.
 *
 * **Opt-in, and that is the point.** A first version read `site/dist` whenever the
 * directory existed, which meant the report was a statement about whichever build
 * happened to be lying on the developer's disk — a stale build passes or fails on
 * yesterday's markup and nobody can tell. So the DOM checks run only when
 * `SITE_DOCTOR_BUILT=1` is set, which the docs workflow sets immediately after
 * `pnpm --filter @automate/docs build` and nobody sets by hand. Without it they report
 * `GAP` and name the build, which is the honest answer and the rule the roadmap's own
 * risk table gives: an unimplemented check reports `GAP` with what it would need, never
 * a silent pass.
 *
 * @returns {Array<{ file: string, html: string }> | null}
 */
function builtHtml() {
  if (process.env['SITE_DOCTOR_BUILT'] !== '1') return null;
  const dist = path.join(ROOT, 'site', 'dist');
  if (!existsSync(dist)) return null;
  return indexFiles(dist)
    .filter((file) => file.endsWith('.html'))
    .map((file) => ({ file, html: read(path.join('site', 'dist', file)) }));
}

/**
 * The pages the heading and metadata checks apply to.
 *
 * `404.html` is excluded, deliberately. It is a generated fallback with no document
 * outline of its own, so "exactly one h1" is not a property it has or lacks — and a
 * check whose only complaint is about a page nobody wrote would train a reviewer to
 * skip it. Recorded here rather than as a filter inside the check, because an exclusion
 * with no stated reason is the thing this script exists to prevent.
 *
 * @param {Array<{ file: string, html: string }> | null} pages
 * @returns {Array<{ file: string, html: string }>}
 */
function contentPages(pages) {
  return (pages ?? []).filter((page) => !page.file.endsWith('404.html'));
}

// ── The ten ─────────────────────────────────────────────────────────────────

/**
 * 1. No hand-typed number outside a generated block.
 *
 * The rule the site's own risk table gives as check 2, and the one that matters most:
 * a marketing page is where an unverified claim survives longest, because nothing on it
 * is regenerated. So a number in prose above the generated marker has to be one a
 * reader can check, and the cheap decidable version is a *count* — "42 rows", "99%
 * coverage", "12 capabilities" — which is what a stale page is made of.
 */
/** @returns {Check} */
function checkNoTypedClaims() {
  const problems = [];
  let examined = 0;
  for (const page of sitePages()) {
    const source = read(page);
    for (const block of stripGenerated(source).split(/\r?\n/)) {
      if (block.trim() === '' || block.startsWith('#')) continue;
      examined += 1;
      // A count in prose: digits, a unit, and no backticks around the digits (a
      // backticked number is a value the reader is sent to the code for).
      const match =
        /(?<!`)\b(\d[\d,.]*)\s*(%|rows?|files?|tests?|capabilities|rules?|routes?|packages?|commits?)\b/i.exec(
          block,
        );
      if (match === null) continue;
      if (/\|/.test(block)) continue; // a table cell quoting the register is a citation
      problems.push(
        `\`${page}\` states "${match[0]}" in prose. A number above the generated marker is typed ` +
          'by a human and goes stale silently; put it in the register or link the command that ' +
          'produces it.',
      );
    }
  }
  return {
    number: 1,
    name: 'no typed claims above a generated block',
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: `${String(examined)} prose line(s) examined.`,
  };
}

/**
 * 2. The published capability table is the register.
 *
 * Recomputes the page's generated block and compares it to what is committed. The
 * capability page reads the whole tree — the register, the ledger, the baseline, and
 * `pnpm status:10` — so the comparison is made in process rather than by copying the
 * generator beside five data files, for the reason `docs-paths.test.mjs` gives.
 */
/** @returns {Check} */
function checkCapabilityHonesty() {
  const register = read('docs/migration/capability-register.md');
  const rows = register
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[a-z0-9][a-z0-9.-]*\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      return { id: cells[0] ?? '', capability: cells[1] ?? '', status: cells[2] ?? '' };
    });
  const published = read('site/pages/capabilities.md');
  if (rows.length === 0) {
    return {
      number: 2,
      name: 'the capability page is the register',
      outcome: 'GAP',
      problems: [],
      note: 'the register has no rows, so there is nothing to compare the page against.',
    };
  }
  // The page publishes the capability's *text* and its status, not the row id — the id is
  // a register handle and a reader has no use for it. So the comparison is on the pair
  // the page actually renders, which is also the pair a reader would be misled by.
  const missing = rows.filter((row) => {
    if (!published.includes(row.capability)) return true;
    return !new RegExp(
      `${escapeRegExp(row.capability)}[^\\n]*\\b${escapeRegExp(row.status)}\\b`,
    ).test(published);
  });
  return {
    number: 2,
    name: 'the capability page is the register',
    outcome: missing.length === 0 ? 'pass' : 'fail',
    problems: missing.map(
      (row) =>
        `\`${row.capability}\` is \`${row.status}\` in the register and the published page does not say ` +
        'so. Run `pnpm site:generate`.',
    ),
    note: `${String(rows.length)} register row(s) compared on capability text and status.`,
  };
}

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 3. Every generated page is current.
 *
 * The risk table's check 10: "artifact staleness, which fails when a source moved and
 * the artifact did not". Recomputed in process from the same builders the generator
 * uses, so the comparison is against a fresh run rather than against a copy.
 */
/** @returns {Check} */
function checkStaleness() {
  const problems = [];
  /** @type {Array<[string, string[]]>} */
  const pages = [['site/pages/quality/ten.md', twelvePage(ROOT)]];
  for (const [page, expected] of pages) {
    const committed = read(page);
    const start = committed.indexOf('<!-- generated: do not edit this block by hand -->');
    if (start === -1) {
      problems.push(`\`${page}\` has no generated marker.`);
      continue;
    }
    const wanted = `${[
      '<!-- generated: do not edit this block by hand -->',
      ...expected,
      '',
      '<!-- /generated -->',
    ].join('\n')}\n`;
    if (committed.slice(start) !== wanted) {
      problems.push(`\`${page}\` is stale. Run \`pnpm site:generate\` and commit the result.`);
    }
  }
  return {
    number: 3,
    name: 'generated pages are current',
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: 'the twelve-point page is the one recomputed here; the other three are compared by `pnpm docs:check`, which copies the generator beside its data files.',
  };
}

/**
 * 4. No broken internal link.
 *
 * The same detector `pnpm docs:check` uses over `docs/`, applied to the site. A link in a
 * site page is more likely to be followed and more expensive when broken, because a
 * reader on the public site has no repository to fall back on.
 */
/** @returns {Check} */
function checkLinks() {
  const environment = collectDriftEnvironment(ROOT, read, () => indexFiles(ROOT), new Set(), []);
  /** @param {string} relative */
  const fileExists = (relative) => {
    const clean = relative.replaceAll('\\', '/').replace(/\/$/, '').replace(/^\//, '');
    return (
      indexFiles(ROOT).some((file) => file === clean || file.startsWith(`${clean}/`)) ||
      // A site link points at a route, not at a file, so `/pages/capabilities` is
      // satisfied by `site/pages/capabilities.md`.
      indexFiles(ROOT).some((file) => file === `site${clean}.md`)
    );
  };
  const environmentForSite = {
    ...environment,
    documents: sitePages().map((file) => ({ path: file, text: read(file) })),
    fileExists,
  };
  const findings = driftFindings(environmentForSite).filter((finding) =>
    finding.includes('link to'),
  );
  return {
    number: 4,
    name: 'no broken internal link',
    outcome: findings.length === 0 ? 'pass' : 'fail',
    problems: findings,
    note: 'a route-style target is resolved against `site/**.md` as well as the file list.',
  };
}

/**
 * 5. No page claims a capability the register marks not `real`.
 *
 * The capability-claim detector, over the site's own pages rather than `docs/`.
 */
/** @returns {Check} */
function checkCapabilityClaims() {
  const register = read('docs/migration/capability-register.md');
  const registerRows = register
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[a-z0-9][a-z0-9.-]*\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      return { id: cells[0] ?? '', capability: cells[1] ?? '', status: cells[2] ?? '' };
    });
  const environment = collectDriftEnvironment(
    ROOT,
    read,
    () => indexFiles(ROOT),
    new Set(),
    registerRows,
  );
  const scoped = {
    ...environment,
    documents: sitePages().map((file) => ({ path: file, text: read(file) })),
  };
  const findings = driftFindings(scoped).filter((finding) => finding.includes('register marks'));
  return {
    number: 5,
    name: 'no page asserts a capability the register does not mark real',
    outcome: findings.length === 0 ? 'pass' : 'fail',
    problems: findings,
    note: `${String(registerRows.length)} register row(s); ${String(registerRows.filter((row) => row.status !== 'real').length)} not \`real\`.`,
  };
}

/**
 * 6. The anti-drift detectors are all implemented, so checks 4 and 5 are not vacuous.
 *
 * A page-level gate built on a detector with no implementation reports a clean site. The
 * site is the *worst* place for that, because it is the one surface a reader cannot
 * check against the repository.
 */
/** @returns {Check} */
function checkDetectorsImplemented() {
  const missing = ASSERTIONS.filter((assertion) => assertion.check === null).map((a) => a.id);
  return {
    number: 6,
    name: 'every anti-drift detector behind checks 4 and 5 is implemented',
    outcome: missing.length === 0 ? 'pass' : 'fail',
    problems: missing.map(
      (id) => `the \`${id}\` assertion has no detector, so checks 4 and 5 are partial.`,
    ),
    note: `${String(ASSERTIONS.length - missing.length)} of ${String(ASSERTIONS.length)} implemented.`,
  };
}

/**
 * 7. Exactly one `h1` per page, and no skipped heading level.
 *
 * Needs the rendered DOM, because a markdown page's heading order is the order the
 * renderer produced. `GAP` without `site/dist`, and `GAP` says so.
 */
/** @param {Array<{ file: string, html: string }> | null} pages
 * @returns {Check} */
function checkHeadings(pages) {
  if (pages === null) return domGap(7, 'one h1 per page, no skipped heading level', 'site/dist');
  const problems = [];
  for (const { file, html } of contentPages(pages)) {
    const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/g)].map((match) => Number(match[1]));
    const h1s = headings.filter((level) => level === 1).length;
    if (h1s !== 1)
      problems.push(`\`${file}\` has ${String(h1s)} h1 element(s); expected exactly 1.`);
    for (let index = 1; index < headings.length; index += 1) {
      const previous = headings[index - 1] ?? 1;
      const level = headings[index] ?? previous;
      if (level > previous + 1) {
        problems.push(`\`${file}\` jumps from h${String(previous)} to h${String(level)}.`);
      }
    }
  }
  return {
    number: 7,
    name: 'one h1 per page, no skipped heading level',
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: `${String(pages.length)} page(s) rendered.`,
  };
}

/**
 * 8. Every image has an alt attribute, and a decorative one is marked decorative.
 *
 * `GAP` without the built site. The check is worth having on a site whose screenshots
 * are the product's evidence: an evidence console's images are the only content a
 * screen reader cannot get from the text around them.
 */
/** @param {Array<{ file: string, html: string }> | null} pages
 * @returns {Check} */
function checkImages(pages) {
  if (pages === null) return domGap(8, 'every image has alt text', 'site/dist');
  const problems = [];
  for (const { file, html } of contentPages(pages)) {
    for (const match of html.matchAll(/<img\b[^>]*>/g)) {
      if (!/\salt=/.test(match[0]))
        problems.push(`\`${file}\` has an <img> with no alt attribute.`);
    }
  }
  return {
    number: 8,
    name: 'every image has alt text',
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: '',
  };
}

/**
 * 9. Every page declares a language and a title.
 *
 * `GAP` without the built site. A page with no `lang` is announced by a screen reader
 * with the wrong pronunciation, and a page with no `<title>` is indistinguishable from
 * every other tab.
 */
/** @param {Array<{ file: string, html: string }> | null} pages
 * @returns {Check} */
function checkLanguageAndTitle(pages) {
  if (pages === null) return domGap(9, 'every page declares a language and a title', 'site/dist');
  const problems = [];
  for (const { file, html } of contentPages(pages)) {
    if (!hasLangAttribute(html)) problems.push(`\`${file}\` has no lang on <html>.`);
    if (!hasTitleElement(html)) problems.push(`\`${file}\` has no <title>.`);
  }
  return {
    number: 9,
    name: 'every page declares a language and a title',
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: '',
  };
}

/**
 * 10. An aspirational claim appears only on a page labelled as not built.
 *
 * D15: "the roadmap page is the only place a not-built capability may appear, and it is
 * labelled". The decidable version is about the *site's* own forward-looking language,
 * and about the governance set the point names — the two things a reader would otherwise
 * take for a claim.
 */
/** @returns {Check} */
function checkGovernanceAndLabelling() {
  const required = [
    ['SECURITY.md', 'a disclosure path and a stated response window'],
    ['CODE_OF_CONDUCT.md', 'the conduct expected of a contributor'],
    ['SUPPORT.md', 'the line between a bug and a capability request'],
    ['CONTRIBUTING.md', 'the review budget, the evidence rule and the not_configured convention'],
    ['LICENSE', 'the licence the code is offered under'],
    ['.github/CODEOWNERS', 'who owns which part of the tree'],
  ];
  const problems = required
    .filter(([file]) => !has(file))
    .map(([file, why]) => `\`${file}\` is absent. §17's twelfth point names ${why}.`);
  return {
    number: 10,
    name: 'the governance set is complete',
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: `D15: a not-built capability may appear only on a labelled page. This check covers the governance half of that, which is machine-decidable; the labelling half is check 5.`,
  };
}

/** A DOM check that needs the built site and cannot run without it. */
/** @param {number} number @param {string} name @param {string} needs
 * @returns {Check} */
function domGap(number, name, needs) {
  return {
    number,
    name,
    outcome: 'GAP',
    problems: [],
    note:
      `needs \`${needs}\` — run \`pnpm --filter @automate/docs build\` first. A check that ` +
      'cannot run reports GAP, never a pass.',
  };
}

/**
 * The block outside the generated markers, which a human is allowed to write.
 *
 * @param {string} source
 * @returns {string}
 */
function stripGenerated(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('<!-- generated') && !line.startsWith('<!-- /generated'))
    .join('\n');
}

/**
 * All ten, in order.
 *
 * @returns {Check[]}
 */
export function runSiteDoctor() {
  const pages = builtHtml();
  return [
    checkNoTypedClaims(),
    checkCapabilityHonesty(),
    checkStaleness(),
    checkLinks(),
    checkCapabilityClaims(),
    checkDetectorsImplemented(),
    checkHeadings(pages),
    checkImages(pages),
    checkLanguageAndTitle(pages),
    checkGovernanceAndLabelling(),
  ];
}

/**
 * Whether the `<html>` element carries a `lang` attribute.
 *
 * Parsed rather than matched. A regular expression for this is an adjacent negated
 * character class around a quantified group, which `security/detect-unsafe-regex` flags
 * — and building it as a string is flagged too, so the flag is about the shape rather
 * than the syntax. Reading the attribute off the tag says the same thing with no pattern
 * to be ambiguous about, and it is the same choice `health.test.ts` makes for a sample
 * line.
 *
 * @param {string} html
 */
/** @param {string} html
 * @returns {boolean} */
function hasLangAttribute(html) {
  const tag = /^<html\b[^>]*>/.exec(html.trim())?.[0];
  if (tag === undefined) return false;
  // The attribute is read off the tag rather than matched out of the whole document, so
  // the pattern is a single anchored literal with no adjacent quantifier — which is what
  // `security/detect-unsafe-regex` can reason about. Splitting on whitespace is the
  // cheapest way to that, and a `lang` attribute is a whitespace-delimited token like
  // every other one in the tag.
  const attribute = tag.split(/\s+/).find((token) => token.startsWith('lang='));
  if (attribute === undefined) return false;
  return isLanguageTag(attribute.slice('lang='.length).replace(/^"|"$/g, ''));
}

/**
 * A BCP-47 language tag, checked segment by segment.
 *
 * By hand rather than by one pattern, and the reason is the same as above:
 * `^[a-z]{2,3}(-[A-Za-z0-9]+)*$` is a quantified group immediately after a quantified
 * group, which the analyser flags however it is written. Splitting on the separator and
 * checking each segment is both readable and unflaggable, and it says what a language
 * tag *is* — a primary subtag, then subtags — rather than leaving that to a regex.
 *
 * @param {string} value
 */
/** @param {string} value
 * @returns {boolean} */
function isLanguageTag(value) {
  const segments = value.split('-');
  const primary = segments[0] ?? '';
  if (!/^[a-z]{2,3}$/.test(primary)) return false;
  return segments.slice(1).every((segment) => /^[A-Za-z0-9]{1,8}$/.test(segment));
}

/** @param {string} html */
function hasTitleElement(html) {
  const title = /<title>([^<]*)<\/title>/.exec(html);
  return title !== null && (title[1] ?? '').trim() !== '';
}

/**
 * The worst outcome in a list, by `OUTCOMES` order.
 *
 * @param {Check[]} checks
 * @returns {Outcome}
 */
export function worstOf(checks) {
  for (const outcome of OUTCOMES) {
    if (checks.some((check) => check.outcome === outcome)) {
      return /** @type {Outcome} */ (outcome);
    }
  }
  return 'pass';
}

// The report, and the exit code. `GAP` does not fail the build — a check that cannot
// run is not a defect — but every GAP is printed, so a run with three of them cannot be
// mistaken for a run with none.
const checks = runSiteDoctor();
const outcome = worstOf(checks);

console.log('Site doctor — the ten checks');
console.log('');
for (const check of checks) {
  const label = check.outcome === 'GAP' ? 'GAP       ' : check.outcome.padEnd(10);
  console.log(`  ${label} ${String(check.number).padStart(2)}. ${check.name}`);
  for (const problem of check.problems) console.log(`               - ${problem}`);
  if (check.note !== '') console.log(`               ${check.note}`);
}
console.log('');
/** @type {Record<Outcome, number>} */
const counts = { pass: 0, fail: 0, GAP: 0 };
for (const check of checks) counts[check.outcome] += 1;
console.log(
  `${String(counts.pass)} pass · ${String(counts.fail)} fail · ${String(counts.GAP)} GAP, of 10.`,
);
if (counts.GAP > 0) {
  console.log(
    'A GAP is a check that could not run, and it is not a pass. Build the site to close them.',
  );
}
console.log('');

if (outcome === 'fail') process.exit(1);
