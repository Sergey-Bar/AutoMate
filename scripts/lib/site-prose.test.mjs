import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The generated pages have to *mean* something to a reader who has never opened the source.
 *
 * `site/pages/capabilities.md` listed five counts — `real 16`, `mock 14`, `missing 2`,
 * `deferred 8`, `obsolete 2` — with no indication what any of those words meant, on the page a
 * reader lands on to answer "does this product do the thing I need". The register that
 * generates it defines each status in one sentence, twenty lines above the table, and the
 * generator read the table and dropped the vocabulary on the floor.
 *
 * So the claim these tests make is narrow and mechanical: **every status the page counts
 * appears with the register's own definition, and every generated page names the command that
 * regenerates it.** Neither is a matter of taste. The definitions are read out of
 * `docs/migration/capability-register.md` rather than restated here, because a second copy of
 * a vocabulary is the defect this repository records as `no-second-authority` — the same
 * reason `scripts/skill-scan.mjs` derives its vendored list from `skills-lock.json` rather
 * than holding a literal.
 */
const register = readFileSync(
  path.join(repoRoot, 'docs', 'migration', 'capability-register.md'),
  'utf8',
);

/** The register's `## Status vocabulary` section, as `status → definition`. */
/**
 * The register's `## Status vocabulary` section, as `status -> definition`.
 *
 * @returns {Map<string, string>}
 */
function vocabularyDefinitions() {
  const section = /##\s+Status vocabulary\s*\n([\s\S]*?)\n##\s/.exec(register)?.[1] ?? '';
  /** @type {Map<string, string>} */
  const definitions = new Map();
  for (const line of section.split('\n')) {
    const match = /^-\s+`([a-z]+)`\s+[—-]\s+(.+?)\s*$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) definitions.set(match[1], match[2]);
  }
  return definitions;
}

/** @param {string} slug @returns {string} */
const generated = (slug) => readFileSync(path.join(repoRoot, 'site', 'pages', slug), 'utf8');

test('the register defines every status the generator counts', () => {
  // A control arm for the reader below. If the parse above ever returns nothing, the
  // capability test below would pass vacuously — which is the failure this file exists
  // because of.
  assert.ok(
    vocabularyDefinitions().size >= 5,
    `the status vocabulary parsed ${String(vocabularyDefinitions().size)} entries, so a ` +
      'test built on it would prove nothing',
  );
});

test("capabilities.md gives every status it counts the register's own meaning", () => {
  const definitions = vocabularyDefinitions();
  const page = generated('capabilities.md');
  // Read from the table, because that is the shape the page now uses. The first version of
  // this test counted the old bullet list and reported "0 statuses found" against a page that
  // had been improved — a test that fails on the improvement is a test that was measuring the
  // markup rather than the claim.
  const counted = [...page.matchAll(/^\| \*\*([a-z]+)\*\* +\| +(\d+) +\|/gm)]
    .map(([, status]) => status ?? '')
    .filter((status) => status.length > 0);
  assert.ok(counted.length >= 4, `only ${String(counted.length)} statuses found on the page`);
  for (const status of counted) {
    const definition = definitions.get(status);
    assert.ok(
      definition,
      `the register does not define \`${status}\`, so the page cannot explain it`,
    );
    assert.ok(
      page.includes(definition),
      `capabilities.md counts \`${status}\` without saying what it means. The register's own ` +
        `sentence is: "${String(definition)}"`,
    );
  }
});

test('capabilities.md says which statuses a reader should act on', () => {
  // A counts table is a description, not a conclusion. `missing` and `mock` are the two a
  // reader is being told something they might want to change, and the page does not say so.
  const page = generated('capabilities.md');
  for (const status of ['missing', 'mock']) {
    assert.ok(
      page.includes(`\`${status}\``),
      `the page never names \`${status}\`, so a reader cannot tell which rows are the ones to act on`,
    );
  }
});

test('every generated page names the command that regenerates it', () => {
  for (const slug of [
    'capabilities.md',
    'quality/findings.md',
    'quality/coverage.md',
    'quality/ten.md',
  ]) {
    const page = generated(slug);
    assert.ok(
      page.includes('pnpm site:generate'),
      `${slug} does not say how to regenerate itself, so a reader who wants to change a number ` +
        'has to find the generator before they can find the source',
    );
  }
});
