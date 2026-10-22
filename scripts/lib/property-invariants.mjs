/**
 * The property-invariants register, and the checks that keep it honest.
 *
 * `docs/quality/property-invariants.json` lists every invariant a `*.property.test.ts` suite
 * states. A suite nothing lists can be deleted without anyone noticing, and an invariant with
 * no suite is a sentence, so the register and the tree are held to each other in both
 * directions. Dependency-free, and pure over an injected view of the tree so the negative
 * cases are testable without touching the real one.
 */

/**
 * @typedef {object} Invariant
 * @property {string} id
 * @property {string} statement
 * @property {string} package
 * @property {string} testFile repository-relative, `/`-separated
 * @property {number} seed
 */

/**
 * @typedef {object} Tree
 * @property {(relative: string) => string | null} read file contents, `null` when absent
 * @property {string[]} propertyTests every `*.property.test.ts` under `apps/` and `packages/`
 */

const ID = /^[A-Z]+-\d+$/;

/**
 * Findings about one register row, and the file it names when it names a readable one.
 *
 * @param {unknown} raw
 * @param {Set<string>} seenIds
 * @param {Tree} tree
 * @returns {{ findings: string[], file: string | null }}
 */
function rowFindings(raw, seenIds, tree) {
  /** @type {string[]} */
  const findings = [];
  const row = /** @type {Partial<Invariant>} */ (raw ?? {});
  const id = typeof row.id === 'string' ? row.id : '(no id)';
  if (typeof row.id !== 'string' || !ID.test(row.id)) findings.push(`${id}: id is not like ORCH-1`);
  if (seenIds.has(id)) findings.push(`${id}: listed twice`);
  seenIds.add(id);
  if (typeof row.statement !== 'string' || row.statement.trim() === '') {
    findings.push(`${id}: no statement`);
  }
  if (typeof row.seed !== 'number' || !Number.isInteger(row.seed)) {
    findings.push(`${id}: no integer seed`);
  }
  if (typeof row.testFile !== 'string' || !row.testFile.endsWith('.property.test.ts')) {
    findings.push(`${id}: testFile is not a *.property.test.ts`);
    return { findings, file: null };
  }
  const source = tree.read(row.testFile);
  if (source === null) {
    findings.push(`${id}: ${row.testFile} does not exist`);
    return { findings, file: row.testFile };
  }
  if (!source.includes(`${id}:`)) {
    findings.push(`${id}: ${row.testFile} has no describe block named "${id}: ..."`);
  }
  const fixed = typeof row.seed === 'number' && new RegExp(`SEED\\s*=\\s*${String(row.seed)}\\b`);
  if (fixed && !fixed.test(source)) {
    findings.push(`${id}: ${row.testFile} does not fix the seed ${String(row.seed)}`);
  }
  return { findings, file: row.testFile };
}

/**
 * Findings about one listed suite as a whole, independent of which invariant listed it.
 *
 * @param {string} file
 * @param {string} source
 * @param {Set<string>} seenIds
 * @returns {string[]}
 */
function fileFindings(file, source, seenIds) {
  /** @type {string[]} */
  const findings = [];
  if (!/numRuns\s*:/.test(source)) findings.push(`${file}: no fixed numRuns`);
  if (!/\bseed\b/.test(source)) findings.push(`${file}: never passes the seed to fast-check`);
  if (!source.includes('the property harness can fail')) {
    findings.push(`${file}: has no test showing the harness can fail`);
  }
  if (/\.(skip|only)\s*\(/.test(source)) findings.push(`${file}: skips or focuses a test`);
  // An invariant the suite states that the register does not list.
  for (const match of source.matchAll(/describe\(\s*'([A-Z]+-\d+):/g)) {
    const id = match[1] ?? '';
    if (!seenIds.has(id)) findings.push(`${file}: states ${id}, which the register does not list`);
  }
  return findings;
}

/**
 * @param {unknown} register
 * @param {Tree} tree
 * @returns {string[]} one finding per problem; empty means the register and the tree agree
 */
export function propertyInvariantFindings(register, tree) {
  const rows = /** @type {{ invariants?: unknown }} */ (register ?? {}).invariants;
  if (!Array.isArray(rows) || rows.length === 0) {
    // A check that measured nothing is not a pass.
    return ['the register lists no invariants'];
  }
  /** @type {string[]} */
  const findings = [];
  /** @type {Set<string>} */
  const seenIds = new Set();
  /** @type {Set<string>} */
  const listedFiles = new Set();
  for (const raw of rows) {
    const row = rowFindings(raw, seenIds, tree);
    findings.push(...row.findings);
    if (row.file !== null) listedFiles.add(row.file);
  }
  for (const file of listedFiles) {
    const source = tree.read(file) ?? '';
    if (source !== '') findings.push(...fileFindings(file, source, seenIds));
  }
  for (const file of tree.propertyTests) {
    if (!listedFiles.has(file)) findings.push(`${file}: a property suite no invariant lists`);
  }
  return findings;
}
