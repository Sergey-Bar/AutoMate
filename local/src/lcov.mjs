/**
 * lcov to the candidate coverage snapshot (spike S1). Throwaway prototype code.
 *
 * Policy, all proposals:
 *
 * - A metric a file does not report is `null`, never zero. Totals cover the files that
 *   report the metric, and a warning says when that is fewer than all of them.
 * - Detail beats summary. Line, function and branch counts are derived from the `DA`, `FN`
 *   and `BRDA` records, and the `LF`/`LH`-style summaries are only a cross-check. A
 *   disagreement is a warning; the derived value is used.
 * - A percentage is `null` when nothing was found, so an empty file is not 0% or 100%.
 */
import { TextDecoder } from 'node:util';
import { rejected } from './model.mjs';

const MAX_BYTES = 64 * 1024 * 1024;

const KNOWN_TAGS = new Set([
  'TN',
  'SF',
  'FN',
  'FNDA',
  'FNF',
  'FNH',
  'FNL',
  'FNA',
  'BRDA',
  'BRF',
  'BRH',
  'DA',
  'LF',
  'LH',
  'VER',
  'end_of_record',
]);

/**
 * @typedef {{ found: number, hit: number }} Counter
 * @typedef {{ path: string, lines: Counter, functions: Counter | null,
 *   branches: Counter | null }} FileCoverage
 */

/**
 * @param {number} found
 * @param {number} hit
 * @returns {number | null}
 */
export function percent(found, hit) {
  return found === 0 ? null : Math.round((hit / found) * 10_000) / 100;
}

/** @returns {Record<string, any>} a fresh accumulator for one `SF` record */
function freshRecord() {
  return {
    path: '',
    da: new Map(),
    fn: new Set(),
    fnda: new Map(),
    brda: [],
    declared: {},
  };
}

/**
 * @param {Record<string, any>} record
 * @param {string[]} warnings
 * @returns {FileCoverage}
 */
function finishRecord(record, warnings) {
  const hitLines = [...record.da.values()].filter((hits) => hits > 0).length;
  /** @type {Counter} */
  let lines = { found: record.da.size, hit: hitLines };
  if (record.da.size === 0 && record.declared.LF !== undefined) {
    lines = { found: record.declared.LF, hit: record.declared.LH ?? 0 };
  } else if (
    (record.declared.LF !== undefined && record.declared.LF !== lines.found) ||
    (record.declared.LH !== undefined && record.declared.LH !== lines.hit)
  ) {
    warnings.push('lcov-count-mismatch');
  }

  /** @type {Counter | null} */
  let functions = null;
  if (record.fn.size > 0) {
    const hit = [...record.fn].filter((name) => (record.fnda.get(name) ?? 0) > 0).length;
    functions = { found: record.fn.size, hit };
    if (
      (record.declared.FNF !== undefined && record.declared.FNF !== functions.found) ||
      (record.declared.FNH !== undefined && record.declared.FNH !== functions.hit)
    ) {
      warnings.push('lcov-count-mismatch');
    }
  } else if (record.declared.FNF !== undefined) {
    functions = { found: record.declared.FNF, hit: record.declared.FNH ?? 0 };
  }

  /** @type {Counter | null} */
  let branches = null;
  if (record.brda.length > 0) {
    branches = {
      found: record.brda.length,
      hit: record.brda.filter((taken) => taken > 0).length,
    };
    if (
      (record.declared.BRF !== undefined && record.declared.BRF !== branches.found) ||
      (record.declared.BRH !== undefined && record.declared.BRH !== branches.hit)
    ) {
      warnings.push('lcov-count-mismatch');
    }
  } else if (record.declared.BRF !== undefined) {
    branches = { found: record.declared.BRF, hit: record.declared.BRH ?? 0 };
  }
  return { path: record.path, lines, functions, branches };
}

/**
 * @param {Record<string, any>} record
 * @param {string} tag
 * @param {string} value
 * @returns {boolean} whether the line was understood
 */
function applyLine(record, tag, value) {
  const parts = value.split(',');
  const integer = (/** @type {string | undefined} */ text) =>
    text !== undefined && /^\d+$/.test(text.trim()) ? Number(text) : null;
  switch (tag) {
    case 'SF':
      record.path = value;
      return value !== '';
    case 'DA': {
      const line = integer(parts[0]);
      const hits = integer(parts[1]);
      if (line === null || hits === null) return false;
      record.da.set(line, (record.da.get(line) ?? 0) + hits);
      return true;
    }
    case 'FN':
      if (integer(parts[0]) === null || parts.length < 2) return false;
      record.fn.add(parts.slice(1).join(','));
      return true;
    case 'FNDA': {
      const hits = integer(parts[0]);
      if (hits === null || parts.length < 2) return false;
      record.fnda.set(parts.slice(1).join(','), hits);
      return true;
    }
    case 'BRDA': {
      const taken = parts[3] === '-' ? 0 : integer(parts[3]);
      if (integer(parts[0]) === null || parts.length !== 4 || taken === null) return false;
      record.brda.push(taken);
      return true;
    }
    case 'LF':
    case 'LH':
    case 'FNF':
    case 'FNH':
    case 'BRF':
    case 'BRH': {
      const count = integer(value);
      if (count === null) return false;
      record.declared[tag] = count;
      return true;
    }
    default:
      return true;
  }
}

/**
 * @param {FileCoverage[]} files
 * @param {'functions' | 'branches'} metric
 * @param {string[]} warnings
 * @returns {{ found: number, hit: number, percent: number | null } | null}
 */
export function totalOf(files, metric, warnings) {
  const reporting = files.filter((file) => file[metric] !== null);
  if (reporting.length === 0) return null;
  if (reporting.length < files.length) warnings.push('metric-not-reported-by-all-files');
  const found = reporting.reduce((sum, file) => sum + (file[metric]?.found ?? 0), 0);
  const hit = reporting.reduce((sum, file) => sum + (file[metric]?.hit ?? 0), 0);
  return { found, hit, percent: percent(found, hit) };
}

/**
 * @param {Uint8Array} bytes
 * @param {{ maxBytes?: number }} [options]
 */
export function parseLcov(bytes, options = {}) {
  if (bytes.length === 0) return rejected('lcov', 'empty-input');
  if (bytes.length > (options.maxBytes ?? MAX_BYTES)) return rejected('lcov', 'too-large');
  const text = new TextDecoder().decode(bytes).replace(/^\ufeff/, '');
  if (!/^SF:/m.test(text)) return rejected('lcov', 'not-lcov');

  /** @type {string[]} */
  const warnings = [];
  /** @type {FileCoverage[]} */
  const files = [];
  let record = freshRecord();
  let open = false;
  let degraded = false;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    const tag = colon === -1 ? line : line.slice(0, colon);
    if (!KNOWN_TAGS.has(tag)) {
      warnings.push('lcov-bad-line');
      degraded = true;
      continue;
    }
    if (tag === 'end_of_record') {
      if (open) files.push(finishRecord(record, warnings));
      record = freshRecord();
      open = false;
      continue;
    }
    if (tag === 'SF') open = true;
    if (!applyLine(record, tag, colon === -1 ? '' : line.slice(colon + 1))) {
      warnings.push('lcov-bad-line');
      degraded = true;
    }
  }
  if (open) {
    files.push(finishRecord(record, warnings));
    warnings.push('lcov-truncated');
    degraded = true;
  }

  const found = files.reduce((sum, file) => sum + file.lines.found, 0);
  const hit = files.reduce((sum, file) => sum + file.lines.hit, 0);
  return {
    kind: /** @type {const} */ ('coverage'),
    format: 'lcov',
    completeness: degraded ? 'unknown' : 'complete',
    files,
    totals: {
      lines: { found, hit, percent: percent(found, hit) },
      functions: totalOf(files, 'functions', warnings),
      branches: totalOf(files, 'branches', warnings),
    },
    warnings: [...new Set(warnings)].sort(),
  };
}
