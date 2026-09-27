/**
 * The history-scan baseline: which secret-scan findings a human has already judged.
 *
 * `pnpm security:secrets:history` walks every commit, so it finds values that were
 * removed from the working tree long ago and are reachable only through `git log`:
 * an old `docker-compose.unified.yml` with a hard-coded localhost password, a
 * deleted evidence file, a test fixture from before `synthetic-credentials.ts`
 * existed. Eleven of them, none a live credential.
 *
 * That is the shape of a gate that gets switched off. In the umbrella as a plain
 * blocker, `pnpm security:verify` is red forever; out of the umbrella, a genuine
 * credential committed yesterday is never scanned for. So neither: the findings are
 * enumerated in `scripts/secret-scan-baseline.json` with a reason each, a known
 * finding is reported and does not fail, and **anything new fails**. An entry that no
 * longer occurs is reported too, because a baseline that can only grow is a
 * permanent blanket exemption wearing a file-and-reason costume.
 */

/**
 * The join separator, named so a file name containing a space cannot collide with
 * the shape that follows it.
 */
const BASELINE_SEPARATOR = String.fromCharCode(31);

/**
 * @typedef {{ file: string, kind: string, why: string }} KnownFinding
 */

/**
 * @param {string} file
 * @param {string} kind
 * @returns {string}
 */
export function keyFor(file, kind) {
  return file + BASELINE_SEPARATOR + kind;
}

/**
 * Parses a baseline document into the map the scan consults.
 *
 * A row missing `file`, `kind`, or a non-empty `why` is dropped rather than
 * honoured, so an unexplained exception is a failing finding and not an exception.
 *
 * @param {unknown} document
 * @returns {Map<string, KnownFinding>}
 */
export function parseBaseline(document) {
  const entries =
    typeof document === 'object' &&
    document !== null &&
    Array.isArray(/** @type {{ findings?: unknown }} */ (document).findings)
      ? /** @type {{ findings: unknown[] }} */ (document).findings
      : [];
  /** @type {Map<string, KnownFinding>} */
  const known = new Map();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { file, kind, why } = /** @type {Record<string, unknown>} */ (entry);
    if (typeof file !== 'string' || typeof kind !== 'string' || typeof why !== 'string') continue;
    if (why.trim() === '') continue;
    known.set(keyFor(file, kind), { file, kind, why });
  }
  return known;
}

/**
 * Splits findings into the ones a human has already judged and the ones nobody has.
 *
 * @param {Array<{ file: string, hits: string[] }>} findings
 * @param {Map<string, KnownFinding>} known
 * @returns {{ newFindings: Array<{ file: string, hits: string[] }>, stale: KnownFinding[] }}
 */
export function partitionByBaseline(findings, known) {
  /** @type {Set<string>} */
  const occurred = new Set();
  /** @type {Map<string, { file: string, hits: string[] }>} */
  const grouped = new Map();
  for (const finding of findings) {
    /** @type {string[]} */
    const kept = [];
    for (const hit of finding.hits) {
      const key = keyFor(finding.file, hit);
      occurred.add(key);
      if (known.has(key)) continue;
      kept.push(hit);
    }
    if (kept.length > 0) grouped.set(finding.file, { file: finding.file, hits: kept });
  }
  // A baseline entry whose exact file-and-kind no longer occurs, so the file can
  // shrink rather than accumulate exemptions.
  const stale = [...known.entries()]
    .filter(([key]) => !occurred.has(key))
    .map(([, entry]) => entry);
  return { newFindings: [...grouped.values()], stale };
}
