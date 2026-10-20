/**
 * Cobertura XML to the same coverage snapshot lcov produces (Phase 5).
 *
 * Policy, the same as for lcov:
 *
 * - A metric a file does not report is `null`, never zero. A class with no `<methods>` has no
 *   function figure; a line with no `condition-coverage` has no branches.
 * - Detail beats summary. Lines, functions and branches are derived from the `<line>` and
 *   `<method>` elements; the declared `lines-valid` and `lines-covered` on the root are only
 *   a cross-check, and a disagreement is a warning.
 * - Several classes can name one file (inner classes). Their lines are merged by line number,
 *   so a file is never counted twice.
 * - The `<sources>` element is not kept: it holds absolute paths of the machine that wrote
 *   the report.
 *
 * Fixtures for this parser are written by hand from the published DTD, not produced by a
 * real tool (see the corpus manifest). That is a limit on what is claimed for it.
 */
import { rejected } from './model.mjs';
import { percent, totalOf } from './lcov.mjs';
import { parseXml } from './xml.mjs';

/** @typedef {import('./xml.mjs').XmlElement} XmlElement */

/**
 * @param {XmlElement} element
 * @param {string} name
 * @returns {XmlElement[]}
 */
function descendants(element, name) {
  /** @type {XmlElement[]} */
  const found = [];
  const walk = (/** @type {XmlElement} */ node) => {
    for (const child of node.children) {
      if (child.name === name) found.push(child);
      walk(child);
    }
  };
  walk(element);
  return found;
}

/** @param {string | undefined} text */
const integer = (text) => (text !== undefined && /^\d+$/.test(text.trim()) ? Number(text) : null);

/**
 * @param {Uint8Array} bytes
 * @param {{ xml?: Partial<import('./xml.mjs').XmlLimits> }} [options]
 */
export function parseCobertura(bytes, options = {}) {
  const xml = parseXml(bytes, options.xml);
  if (xml.rejection !== null) return rejected('cobertura-xml', xml.rejection);
  const { root, malformed, truncated } = xml;
  const warnings = [...xml.warnings];
  if (
    root.name !== 'coverage' ||
    (root.attrs['line-rate'] === undefined && root.attrs['lines-valid'] === undefined)
  ) {
    return rejected('cobertura-xml', 'not-cobertura', warnings);
  }
  let degraded = malformed || truncated;

  /** @type {Map<string, { lines: Map<number, number>, branches: Map<number, { hit: number, total: number }>, methods: Map<string, boolean>, hasMethods: boolean }>} */
  const byFile = new Map();
  for (const cls of descendants(root, 'class')) {
    const filename = cls.attrs.filename;
    if (filename === undefined || filename === '') {
      warnings.push('cobertura-class-without-filename');
      degraded = true;
      continue;
    }
    const file = byFile.get(filename) ?? {
      lines: new Map(),
      branches: new Map(),
      methods: new Map(),
      hasMethods: false,
    };
    byFile.set(filename, file);

    /** @param {XmlElement} line */
    const addLine = (line) => {
      const number = integer(line.attrs.number);
      const hits = integer(line.attrs.hits);
      if (number === null || hits === null) {
        warnings.push('cobertura-bad-line');
        degraded = true;
        return null;
      }
      file.lines.set(number, (file.lines.get(number) ?? 0) + hits);
      const condition = /\((\d+)\/(\d+)\)/.exec(line.attrs['condition-coverage'] ?? '');
      if (condition !== null) {
        const hit = Number(condition[1]);
        const total = Number(condition[2]);
        const known = file.branches.get(number);
        if (known === undefined || total > known.total) file.branches.set(number, { hit, total });
      }
      return hits;
    };

    for (const lines of cls.children.filter((c) => c.name === 'lines')) {
      for (const line of lines.children.filter((c) => c.name === 'line')) addLine(line);
    }
    const methods = cls.children.find((c) => c.name === 'methods');
    if (methods !== undefined) {
      for (const method of methods.children.filter((c) => c.name === 'method')) {
        file.hasMethods = true;
        const key = `${cls.attrs.name ?? ''}\u0000${method.attrs.name ?? ''}\u0000${
          method.attrs.signature ?? ''
        }`;
        const lines = descendants(method, 'line');
        let executed;
        if (lines.length > 0) {
          executed = lines.some((line) => (integer(line.attrs.hits) ?? 0) > 0);
          for (const line of lines) addLine(line);
        } else {
          executed = Number(method.attrs['line-rate'] ?? 0) > 0;
        }
        file.methods.set(key, (file.methods.get(key) ?? false) || executed);
      }
    }
  }

  const files = [...byFile.entries()].map(([path, data]) => {
    const hitLines = [...data.lines.values()].filter((hits) => hits > 0).length;
    const branchTotals = [...data.branches.values()];
    return {
      path,
      lines: { found: data.lines.size, hit: hitLines },
      functions: data.hasMethods
        ? { found: data.methods.size, hit: [...data.methods.values()].filter(Boolean).length }
        : null,
      branches:
        branchTotals.length > 0
          ? {
              found: branchTotals.reduce((s, b) => s + b.total, 0),
              hit: branchTotals.reduce((s, b) => s + b.hit, 0),
            }
          : null,
    };
  });

  const found = files.reduce((sum, file) => sum + file.lines.found, 0);
  const hit = files.reduce((sum, file) => sum + file.lines.hit, 0);
  const declaredValid = integer(root.attrs['lines-valid']);
  const declaredCovered = integer(root.attrs['lines-covered']);
  if (
    (declaredValid !== null && declaredValid !== found) ||
    (declaredCovered !== null && declaredCovered !== hit)
  ) {
    warnings.push('cobertura-count-mismatch');
  }
  if (files.length === 0) warnings.push('cobertura-no-classes');

  return {
    kind: /** @type {const} */ ('coverage'),
    format: 'cobertura-xml',
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
