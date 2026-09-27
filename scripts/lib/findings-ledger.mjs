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
 * @param {unknown} ledger parsed JSON
 * @param {{ root: string, previous?: Record<string, string> | null }} options
 * @returns {{ findings: string[], rows: number, byBand: Record<string, number> }}
 */
export function auditLedger(ledger, options) {
  /** @type {string[]} */
  const findings = [];
  const byBand = /** @type {Record<string, number>} */ ({});
  for (const band of BANDS) byBand[band] = 0;

  if (!isRecord(ledger)) {
    return { findings: ['the ledger is not a JSON object'], rows: 0, byBand };
  }
  const rows = ledger.findings;
  if (!Array.isArray(rows)) {
    return { findings: ['the ledger has no `findings` array'], rows: 0, byBand };
  }

  // A ledger with no rows is the same defect as a gate with no assertions: it
  // passes, and it has measured nothing. The coverage ratchet guards for this in
  // one direction; this is the other.
  if (rows.length === 0) {
    return {
      findings: ['the ledger contains no findings, so the gate measured nothing'],
      rows: 0,
      byBand,
    };
  }

  const seen = new Map();
  const previous = options.previous ?? null;

  for (const [index, entry] of rows.entries()) {
    const at = `findings[${index}]`;
    if (!isRecord(entry)) {
      findings.push(`${at}: not an object`);
      continue;
    }
    const id = entry.id;
    if (!filled(id)) {
      findings.push(`${at}: no \`id\``);
      continue;
    }
    const label = typeof id === 'string' ? id : at;

    if (seen.has(id)) {
      findings.push(`${label}: duplicate id, already used at findings[${seen.get(id)}]`);
    } else {
      seen.set(id, index);
    }

    for (const field of ['title', 'summary']) {
      if (!filled(entry[field])) {
        findings.push(
          `${label}: \`${field}\` is empty. A row that does not say what it is cannot be closed.`,
        );
      }
    }
    if (!filled(entry.band) || !BANDS.includes(/** @type {string} */ (entry.band))) {
      findings.push(`${label}: band must be one of ${BANDS.join(', ')}`);
    } else {
      byBand[/** @type {string} */ (entry.band)] += 1;
    }
    if (
      !filled(entry.provenance) ||
      !PROVENANCE.includes(/** @type {string} */ (entry.provenance))
    ) {
      findings.push(`${label}: provenance must be one of ${PROVENANCE.join(', ')}`);
    }
    if (!filled(entry.status) || !STATUSES.includes(/** @type {string} */ (entry.status))) {
      findings.push(`${label}: status must be one of ${STATUSES.join(', ')}`);
      continue;
    }

    const band = /** @type {string} */ (entry.band);
    const status = /** @type {string} */ (entry.status);

    // §1's binary triage: every confirmed defect has a disposition. An open
    // Blocker or Critical with no wave is a defect nobody has picked up, and it
    // is the single easiest thing for a ledger to accumulate silently.
    if (status === 'open' && BLOCKING_BANDS.has(band) && !filled(entry.wave)) {
      findings.push(
        `${label}: an open ${band} names no wave. A blocking-band finding that no ` +
          'wave owns is indistinguishable from one nobody read.',
      );
    }

    if (status === 'debt') {
      if (BLOCKING_BANDS.has(band)) {
        findings.push(
          `${label}: a ${band} is recorded as debt. Plan §1 forbids debt in the two ` +
            'blocking bands, so this must be fixed or the band re-argued.',
        );
      }
      for (const field of ['owner', 'removalCondition']) {
        if (!filled(entry[field])) {
          findings.push(
            `${label}: \`${field}\` is empty. Debt needs a name and a condition that ` +
              'names a thing which could happen.',
          );
        }
      }
    }

    if (status === 'fixed') {
      const evidence = entry.evidence;
      if (!Array.isArray(evidence) || evidence.length === 0) {
        findings.push(
          `${label}: closed with no evidence. A \`fixed\` row is a claim that something ` +
            'proves it, and the claim is the path to that proof.',
        );
      } else {
        for (const [position, item] of evidence.entries()) {
          if (!isRecord(item) || !filled(item.path) || !filled(item.asserts)) {
            findings.push(`${label}: evidence[${position}] needs both \`path\` and \`asserts\``);
            continue;
          }
          const target = path.join(options.root, /** @type {string} */ (item.path));
          if (!existsSync(target)) {
            findings.push(
              `${label}: evidence path \`${/** @type {string} */ (item.path)}\` does not exist. ` +
                'A closed finding whose proof was deleted is open again.',
            );
          }
        }
      }
      if (
        CONFIRMATION_REQUIRED.has(/** @type {string} */ (id)) &&
        entry.provenance === 'sweep' &&
        entry.confirmed !== true
      ) {
        findings.push(
          `${label}: this is a destructive-migration finding still marked \`sweep\`, and it ` +
            'cannot be closed until someone confirms it by hand (`confirmed: true`).',
        );
      }
    }

    // The status ratchet. A row may move forward and never back: `open` → `fixed`
    // or `open` → `debt` is progress, the reverse is a regression, and removing a
    // row outright is a regression in the only sense that matters — the defect is
    // still in the tree.
    if (previous !== null) {
      const before = previous[/** @type {string} */ (id)];
      if (before === undefined) {
        findings.push(
          `${label}: not in docs/quality/findings-status.json. Run \`pnpm findings:baseline\` ` +
            'to record it, once it has been reviewed.',
        );
      } else if (before !== status) {
        const forward =
          (before === 'open' && status !== 'open') || (before === 'fixed' && status === 'debt');
        if (!forward) {
          findings.push(
            `${label}: status moved from \`${before}\` to \`${status}\`. A status may only ` +
              'improve; a regression fails rather than being recorded.',
          );
        }
      }
    }
  }

  if (previous !== null) {
    for (const id of Object.keys(previous)) {
      if (!seen.has(id)) {
        findings.push(
          `${id}: recorded in findings-status.json but no longer in the ledger. Deleting a row ` +
            'is not a fix; the defect it described is still in the tree.',
        );
      }
    }
  }

  return { findings, rows: rows.length, byBand };
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
