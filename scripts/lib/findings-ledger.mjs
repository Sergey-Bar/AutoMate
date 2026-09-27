/**
 * The findings ledger's rules, as a pure function.
 *
 * `docs/quality/findings-ledger.json` is the machine-checked ledger the plan's §3
 * asks for, and this module is what makes it more than a document. The point is
 * narrow: a ledger is a claim about defects, and a claim that nothing checks is a
 * document. Every rule below corresponds to a sentence in the plan's §1 and §3.
 *
 * Kept separate from the CLI so the rules can be tested against synthetic ledgers,
 * and so a rule that cannot fail is visible as one.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const BANDS = ['Blocker', 'Critical', 'Major', 'Minor', 'Nit'];

/**
 * The two bands that may not be carried as debt.
 *
 * Plan §1: Blocker and Critical are "forbidden" in the debt baseline, and
 * "regressions fail; debt does not grow". Encoding that here is the difference
 * between a policy and a preference.
 */
export const BLOCKING_BANDS = new Set(['Blocker', 'Critical']);

export const PROVENANCE = ['hand', 'sweep'];
export const STATUSES = ['open', 'fixed', 'debt'];

/**
 * Rows a destructive migration depends on, which the plan's §8.1 requires to be
 * spot-confirmed before anything irreversible acts on them.
 *
 * These are the `sweep`-provenance rows whose finding, if wrong, destroys data.
 * The check refuses to let one of them reach `fixed` while it still says
 * `sweep` and carries no confirmation — which is the plan's rule made
 * executable rather than a sentence in a document.
 */
export const CONFIRMATION_REQUIRED = new Set([
  'P-5',
  'P-6',
  'P-7',
  'P-8',
  'P-9',
  'P-10',
  'P-12',
  'P-13',
  'P-20',
  'O-1',
  'O-2',
  'O-3',
  'P-23',
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} */
function filled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Audits one ledger document.
 *
 * `auditLedger` is a shape check and a loop; every rule below is its own small
 * function. That is not tidiness for its own sake: the first version of this file held
 * all nine rules inline in one function, and it was the only file this wave pushed
 * over the complexity ceiling. A rules list that can only be read as one control-flow
 * graph is a rules list nobody can check against a policy sentence.
 *
 * @param {unknown} ledger parsed JSON
 * @param {{ root: string, previous?: Record<string, string> | null }} options
 * @returns {{ findings: string[], rows: number, byBand: Record<string, number> }}
 */
export function auditLedger(ledger, options) {
  const byBand = /** @type {Record<string, number>} */ ({});
  for (const band of BANDS) byBand[band] = 0;

  const documentProblems = shapeProblems(ledger);
  if (documentProblems.length > 0) {
    return { findings: documentProblems, rows: 0, byBand };
  }
  const rows = /** @type {unknown[]} */ (/** @type {{ findings: unknown[] }} */ (ledger).findings);

  /** @type {string[]} */
  const findings = [];
  const previous = options.previous ?? null;
  /** @type {Map<string, number>} */
  const seen = new Map();

  for (const [index, entry] of rows.entries()) {
    const row = rowLabel(entry, index);
    if (row === null) {
      findings.push(`findings[${String(index)}]: not an object`);
      continue;
    }
    const duplicate = duplicateOf(seen, row.label, index);
    if (duplicate !== null) findings.push(duplicate);
    findings.push(...identityProblems(row.label, row.record));
    const band = /** @type {string} */ (row.record.band);
    if (BANDS.includes(band)) byBand[band] += 1;
    findings.push(...rowProblems(row.label, row.record, options.root));
    findings.push(...ratchetProblems(row.label, row.record, previous));
  }

  findings.push(...vanishedProblems(previous, seen));
  return { findings, rows: rows.length, byBand };
}

/**
 * The problems with the ledger as a document rather than with one row.
 *
 * A missing array and an empty array are separate defects with separate messages,
 * because "there is no `findings` key" and "the key is there and holds nothing" point
 * at different mistakes, and a reader who is told the wrong one fixes the wrong thing.
 *
 * @param {unknown} ledger
 * @returns {string[]}
 */
function shapeProblems(ledger) {
  if (!isRecord(ledger)) return ['the ledger is not a JSON object'];
  if (!Array.isArray(ledger.findings)) return ['the ledger has no `findings` array'];
  // A ledger with no rows is the same defect as a gate with no assertions: it passes,
  // and it has measured nothing.
  if (ledger.findings.length === 0) {
    return ['the ledger contains no findings, so the gate measured nothing'];
  }
  return [];
}

/**
 * @typedef {{ label: string, record: Record<string, unknown> }} Row
 */

/**
 * One row's label and its record, or `null` when the row is not even an object.
 *
 * @param {unknown} entry
 * @param {number} index
 * @returns {Row | null}
 */
function rowLabel(entry, index) {
  if (!isRecord(entry)) return null;
  const id = entry.id;
  const label = typeof id === 'string' && id.trim() !== '' ? id : `findings[${String(index)}]`;
  return { label, record: entry };
}

/**
 * The earlier position of a repeated id, as a finding, or `null` when it is new.
 *
 * @param {Map<string, number>} seen
 * @param {string} label
 * @param {number} index
 * @returns {string | null}
 */
function duplicateOf(seen, label, index) {
  const first = seen.get(label);
  if (first !== undefined) {
    return `${label}: duplicate id, already used at findings[${String(first)}]`;
  }
  seen.set(label, index);
  return null;
}

/**
 * The fields every row must carry, whatever its status.
 *
 * @param {string} label
 * @param {Record<string, unknown>} record
 * @returns {string[]}
 */
function identityProblems(label, record) {
  /** @type {string[]} */
  const findings = [];
  if (!filled(record.id)) {
    findings.push(`${label}: no \`id\``);
  }
  for (const field of ['title', 'summary']) {
    if (!filled(record[field])) {
      findings.push(
        `${label}: \`${field}\` is empty. A row that does not say what it is cannot be closed.`,
      );
    }
  }
  if (!filled(record.band) || !BANDS.includes(/** @type {string} */ (record.band))) {
    findings.push(`${label}: band must be one of ${BANDS.join(', ')}`);
  }
  if (
    !filled(record.provenance) ||
    !PROVENANCE.includes(/** @type {string} */ (record.provenance))
  ) {
    findings.push(`${label}: provenance must be one of ${PROVENANCE.join(', ')}`);
  }
  return findings;
}

/**
 * The status of a row, or `null` when the audit cannot read it.
 *
 * `null` matters: a status the audit cannot read must not be treated as `open`, or a
 * typo in a status turns into a fresh set of findings about a row nobody changed.
 *
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function statusOf(record) {
  const status = record.status;
  return typeof status === 'string' && STATUSES.includes(status) ? status : null;
}

/**
 * Every status-specific rule for one row, plus the unreadable-status report.
 *
 * @param {string} label
 * @param {Record<string, unknown>} record
 * @param {string} root
 * @returns {string[]}
 */
function rowProblems(label, record, root) {
  const status = statusOf(record);
  if (status === null) {
    return [`${label}: status must be one of ${STATUSES.join(', ')}`];
  }
  return STATUS_RULES[status](label, record, root);
}

/** @type {Record<string, (label: string, record: Record<string, unknown>, root: string) => string[]>} */
const STATUS_RULES = {
  // §1's binary triage: every confirmed defect has a disposition. An open Blocker or
  // Critical with no wave is a defect nobody has picked up, and it is the single
  // easiest thing for a ledger to accumulate silently.
  open(label, record) {
    const band = /** @type {string} */ (record.band);
    if (!BLOCKING_BANDS.has(band) || filled(record.wave)) return [];
    return [
      `${label}: an open ${band} names no wave. A blocking-band finding that no ` +
        'wave owns is indistinguishable from one nobody read.',
    ];
  },
  debt(label, record) {
    /** @type {string[]} */
    const findings = [];
    const band = /** @type {string} */ (record.band);
    if (BLOCKING_BANDS.has(band)) {
      findings.push(
        `${label}: a ${band} is recorded as debt. Plan §1 forbids debt in the two ` +
          'blocking bands, so this must be fixed or the band re-argued.',
      );
    }
    for (const field of ['owner', 'removalCondition']) {
      if (!filled(record[field])) {
        findings.push(
          `${label}: \`${field}\` is empty. Debt needs a name and a condition that ` +
            'names a thing which could happen.',
        );
      }
    }
    return findings;
  },
  fixed(label, record, root) {
    return [...evidenceProblems(label, record, root), ...confirmationProblems(label, record)];
  },
};

/**
 * @param {string} label
 * @param {Record<string, unknown>} record
 * @param {string} root
 * @returns {string[]}
 */
function evidenceProblems(label, record, root) {
  const evidence = record.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return [
      `${label}: closed with no evidence. A \`fixed\` row is a claim that something ` +
        'proves it, and the claim is the path to that proof.',
    ];
  }
  /** @type {string[]} */
  const findings = [];
  for (const [position, item] of evidence.entries()) {
    if (!isRecord(item) || !filled(item.path) || !filled(item.asserts)) {
      findings.push(`${label}: evidence[${String(position)}] needs both \`path\` and \`asserts\``);
      continue;
    }
    if (existsSync(path.join(root, /** @type {string} */ (item.path)))) continue;
    findings.push(
      `${label}: evidence path \`${/** @type {string} */ (item.path)}\` does not exist. ` +
        'A closed finding whose proof was deleted is open again.',
    );
  }
  return findings;
}

/**
 * Plan §8.1: the load-bearing `sweep` rows must be spot-confirmed by a human before
 * anything irreversible acts on them. A row nobody has read cannot be closed.
 *
 * @param {string} label
 * @param {Record<string, unknown>} record
 * @returns {string[]}
 */
function confirmationProblems(label, record) {
  if (record.confirmed === true) return [];
  if (record.provenance !== 'sweep') return [];
  if (!CONFIRMATION_REQUIRED.has(label)) return [];
  return [
    `${label}: this is a destructive-migration finding still marked \`sweep\`, and it ` +
      'cannot be closed until someone confirms it by hand (`confirmed: true`).',
  ];
}

/**
 * A status may move forward and never back.
 *
 * `open` → `fixed` or `open` → `debt` is progress, and `fixed` → `debt` is a statement
 * that the fix was wrong. The reverse is a regression, and a row that is not in the
 * recorded statuses at all is a new row nobody has reviewed yet.
 *
 * @param {string} label
 * @param {Record<string, unknown>} record
 * @param {Record<string, string> | null} previous
 * @returns {string[]}
 */
function ratchetProblems(label, record, previous) {
  if (previous === null) return [];
  const status = statusOf(record);
  const before = previous[label];
  if (before === undefined) {
    return [
      `${label}: not in docs/quality/findings-status.json. Run \`pnpm findings:baseline\` ` +
        'to record it, once it has been reviewed.',
    ];
  }
  if (status === null || before === status) return [];
  if (isForward(before, /** @type {string} */ (status))) return [];
  return [
    `${label}: status moved from \`${before}\` to \`${status}\`. A status may only ` +
      'improve; a regression fails rather than being recorded.',
  ];
}

/** @param {string} before @param {string} after @returns {boolean} */
function isForward(before, after) {
  if (before === 'open') return after !== 'open';
  if (before === 'fixed') return after === 'debt';
  return false;
}

/**
 * A row that was recorded and is no longer present.
 *
 * Deleting a row is not a fix: the defect it described is still in the tree, and the
 * ledger is the only thing that said so.
 *
 * @param {Record<string, string> | null} previous
 * @param {Map<string, number>} seen
 * @returns {string[]}
 */
function vanishedProblems(previous, seen) {
  if (previous === null) return [];
  return Object.keys(previous)
    .filter((id) => !seen.has(id))
    .map(
      (id) =>
        `${id}: recorded in findings-status.json but no longer in the ledger. Deleting a ` +
        'row is not a fix; the defect it described is still in the tree.',
    );
}

/**
 * The repository root, resolved from this module's own location.
 *
 * `import.meta.dirname` because the root package.json is `"type": "module"` and
 * `__dirname` does not exist in that scope — the same defect
 * `playwright.config.ts` carried, and the reason the E2E suite collected nothing.
 *
 * @returns {string}
 */
export function repoRoot() {
  return path.resolve(import.meta.dirname, '..', '..');
}

/**
 * @param {string} relative
 * @returns {unknown}
 */
export function readLedger(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot(), relative), 'utf8'));
}
