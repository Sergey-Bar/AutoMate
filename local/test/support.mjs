/**
 * Shared helpers for the spike tests: loading the corpus, building the in-memory fixtures,
 * and projecting a result onto the shape the committed goldens use.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TextEncoder } from 'node:util';
import { countsOf, OUTCOMES } from '../src/model.mjs';

export const LOCAL_ROOT = path.resolve(import.meta.dirname, '..');
export const CORPUS_DIR = path.join(LOCAL_ROOT, 'corpus');
export const FILES_DIR = path.join(CORPUS_DIR, 'files');
export const REPO_ROOT = path.resolve(LOCAL_ROOT, '..');

/**
 * @typedef {{ id: string, file?: string, generator?: string, kind: string,
 *   context?: Record<string, string>, options?: Record<string, unknown>,
 *   provenance: Record<string, string | null> }} ManifestEntry
 */

/** @returns {ManifestEntry[]} */
export function loadManifest() {
  return JSON.parse(readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf8'));
}

/** @returns {Record<string, any>} */
export function loadGoldens() {
  return JSON.parse(readFileSync(path.join(CORPUS_DIR, 'goldens.json'), 'utf8'));
}

const encoder = new TextEncoder();

/** @type {Record<string, () => Uint8Array>} */
const GENERATORS = {
  'junit-oversized-message': () =>
    encoder.encode(
      `<testsuite name="Big" tests="1" failures="1"><testcase classname="Big" name="big">` +
        `<failure message="${'x'.repeat(20_000)}"/></testcase></testsuite>`,
    ),
  'junit-too-large': () =>
    encoder.encode(`<testsuite name="Big" tests="1">${'<!-- padding -->'.repeat(130)}</testsuite>`),
  'junit-too-deep': () => encoder.encode(`${'<a>'.repeat(300)}${'</a>'.repeat(300)}`),
  'junit-many-tests': () =>
    encoder.encode(
      `<testsuite name="Many" tests="150">${Array.from(
        { length: 150 },
        (_, index) => `<testcase classname="Many" name="t${String(index)}"/>`,
      ).join('')}</testsuite>`,
    ),
};

/**
 * @param {ManifestEntry} entry
 * @returns {Uint8Array}
 */
export function bytesFor(entry) {
  if (entry.generator !== undefined) {
    const build = GENERATORS[entry.generator];
    if (build === undefined) throw new Error(`no generator named ${entry.generator}`);
    return build();
  }
  return readFileSync(path.join(FILES_DIR, entry.file ?? ''));
}

/**
 * @param {ManifestEntry} entry
 * @returns {{ repoRoot?: string } & Record<string, unknown>}
 */
export function optionsFor(entry) {
  return {
    ...(entry.context?.repoRoot === undefined ? {} : { repoRoot: entry.context.repoRoot }),
    ...entry.options,
  };
}

/**
 * Projects a result onto the golden shape. Only the fields a golden names are compared for
 * each test, so a golden states what matters instead of restating everything.
 *
 * @param {any} result
 * @param {any} golden the committed golden for this fixture
 */
export function project(result, golden) {
  const goldenTests = golden?.tests;
  if (result.kind === 'rejected') {
    return {
      kind: 'rejected',
      format: result.format,
      rejection: result.rejection,
      warnings: result.warnings,
    };
  }
  if (result.kind === 'coverage') {
    return {
      kind: 'coverage',
      format: result.format,
      completeness: result.completeness,
      files: result.files.length,
      lines: result.totals.lines,
      functions: result.totals.functions,
      branches: result.totals.branches,
      warnings: result.warnings,
      ...(golden?.perFile === undefined ? {} : { perFile: result.files }),
    };
  }
  const counts = countsOf(result);
  /** @type {Record<string, number>} */
  const nonZero = { tests: counts.tests ?? 0, attempts: counts.attempts ?? 0 };
  for (const outcome of OUTCOMES)
    if ((counts[outcome] ?? 0) > 0) nonZero[outcome] = counts[outcome] ?? 0;

  const tests = Array.isArray(goldenTests)
    ? result.tests.map((/** @type {any} */ test, /** @type {number} */ position) => {
        const wanted = goldenTests[position] ?? {};
        const last = test.attempts.at(-1);
        /** @type {Record<string, unknown>} */
        const full = {
          name: test.name,
          outcome: test.outcome,
          attempts: test.attempts.length,
          flakiness: test.flakiness,
          project: test.project,
          file: test.file,
          durationMs: last?.durationMs ?? null,
          messageLength: test.attempts[0]?.message?.length ?? 0,
        };
        return Object.fromEntries(Object.keys(wanted).map((key) => [key, full[key]]));
      })
    : null;
  return {
    kind: 'run',
    format: result.format,
    completeness: result.completeness,
    runStatus: result.runStatus,
    counts: nonZero,
    tests,
    warnings: result.warnings,
  };
}
