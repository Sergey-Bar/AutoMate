/**
 * The findings ledger's rules, as a pure function.
 *
 * `docs/quality/findings-ledger.json` is the machine-checked ledger the plan's §3
 * asks for, and this module is what makes it more than a document. The point is
 * narrow: a ledger is a claim about defects, and a claim that nothing checks is a
 * document. Every rule below corresponds to a sentence in the plan's §1 and §3.
 *
 * The rule with the most weight is the newest one: **every `sweep`-provenance row must
 * be hand-confirmed before it can close, and a row that turns out to be wrong gets a
 * disposition instead of a deletion.** The previous version asked humans to read the
 * rows a migration would destroy and had no way to record that they had — see
 * `confirmationProblems` and `STATUS_RULES['false-positive']`.
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

/**
 * The four dispositions, and the only four.
 *
 * `open`, `fixed` and `debt` are a triage. `false-positive` is the fourth because
 * hand-confirmation is only honest if "I read it and it is not there" is a thing the
 * ledger can record — see the rule in `STATUS_RULES` and the note on `isForward`.
 */
export const STATUSES = ['open', 'fixed', 'debt', 'false-positive'];

/** Where the wave gates live, relative to the repository root. */
export const WAVE_GATES = 'docs/quality/wave-gates.json';

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
  // The fourth disposition, and the one that makes hand-confirmation honest.
  //
  // Before it existed, refuting a finding meant deleting its row — and deleting a row
  // is itself a finding here, because the ratchet fails when a recorded row vanishes
  // ("deleting a row is not a fix; the defect it described is still in the tree"). So
  // a person who read P-23 and found it wrong had two moves: leave it open and lie
  // about it, or delete it and turn the ledger gate red. Neither is a choice a person
  // makes when the finding is genuinely false, which is the whole point of reading it.
  //
  // `refutedBy` is required because "false positive" with no pointer is
  // indistinguishable from a row nobody wanted to fix, and those two need very
  // different amounts of trust from the next reader.
  'false-positive'(label, record) {
    if (filled(record.refutedBy)) return [];
    return [
      `${label}: a refuted finding must say what refutes it. \`refutedBy\` names the ` +
        'file:line, commit or observation showing the defect is not there — without it, ' +
        '"false positive" is indistinguishable from a row nobody wanted to fix.',
    ];
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
 * Plan §8.1 generalized: **every** `sweep` row must be hand-confirmed before it can
 * be closed. A row nobody has read is a claim produced by a script, and a claim
 * nobody has read cannot be closed.
 *
 * Kept as its own function, and kept off `STATUS_RULES.fixed`'s critical path, so the
 * rule reads as the one sentence it is. See the note on `STATUSES` for why the id set
 * it used to consult is gone.
 *
 * @param {string} label
 * @param {Record<string, unknown>} record
 * @returns {string[]}
 */
function confirmationProblems(label, record) {
  if (record.confirmed === true) return [];
  if (record.provenance !== 'sweep') return [];
  return [
    `${label}: this is a \`sweep\` finding, which means an automated sweep produced it and ` +
      'no human has read it since. It cannot be closed until someone confirms it against ' +
      'the code (`confirmed: true`), or refutes it (`status: "false-positive"` with a ' +
      '`refutedBy` note).',
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

/**
 * A status may move forward and never back.
 *
 * `open` → `fixed` or `open` → `debt` is progress, and `fixed` → `debt` is a statement
 * that the fix was wrong. `false-positive` is forward from every other status, because
 * it is a correction of the record rather than of the code — including from `fixed`,
 * which is the case that matters most: the fix was sound work against a defect that
 * was not there, and the row must be able to say so. It is terminal, because a
 * refutation somebody has not read is not a refutation.
 *
 * @param {string} before @param {string} after @returns {boolean}
 */
function isForward(before, after) {
  if (before === 'open') return after !== 'open';
  if (after !== 'false-positive') return before === 'fixed' && after === 'debt';
  return before === 'fixed' || before === 'debt';
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

// ── The wave gates ───────────────────────────────────────────────────────────
//
// A wave is a unit of work with an entry condition. Until `wave-gates.json` existed,
// this repository's entry conditions were sentences in documents, and a sentence
// does not fail: RF-5's `removalCondition` has said since 2026-09-27 that W7 entering
// scope returns the row to `open`/`Blocker`, and five tenancy migrations later the row
// was still `debt`.
//
// Two questions, two gates, and the split is not arbitrary:
//
//   - **Does the manifest still describe this repository?** `auditWaveGates`, here.
//     A migration that was renamed, a gating row that no longer exists, a
//     `blocksWave` pointing at a wave nothing declares. That is file hygiene, and it
//     belongs with the other checks on these two documents.
//   - **Did a wave land before its gate did?** `checkWaveBlocks` in `merge-gate.mjs`.
//     That is a merge-time judgement about the ledger, it is already how `RF-5` is
//     caught (as an open Blocker, by `checkLedger`), and putting it here made
//     `pnpm verify` red on a defect nothing but this repository's own definition of
//     done can clear. A rule that reports the same contradiction in three places is
//     three places to silence it; two is enough.

/**
 * @typedef {object} WaveGate
 * @property {string} gate what has to be true before the wave's work is allowed
 * @property {string[]} gatingRows the ledger rows that gate it
 * @property {string[]} [migrations] the migrations that put the wave on disk
 * @property {string[]} [landedBy] other files that put it on disk, for a wave that
 *   changes no schema. At least one of `migrations` and `landedBy` must be present.
 */

/**
 * @param {unknown} value
 * @returns {string[] | null} `null` when the value is not a list of non-blank strings
 */
function stringList(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => filled(item));
}

/**
 * The ledger's rows by id, or an empty map when the document has no rows.
 *
 * The whole record rather than the fields each caller happens to read, because the
 * first version of this took `{ status }` and then `blocksWave` was invisible to the
 * rule that exists to check it — a rule that cannot see its own subject is a rule
 * that cannot fail, which is the whole defect this module is about.
 *
 * @param {unknown} ledger
 * @returns {Map<string, Record<string, unknown>>}
 */
function rowsById(ledger) {
  const rows = isRecord(ledger) ? ledger.findings : null;
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  if (!Array.isArray(rows)) return byId;
  for (const row of rows) {
    if (isRecord(row) && filled(row.id)) {
      byId.set(/** @type {string} */ (row.id), row);
    }
  }
  return byId;
}

/**
 * Whether a wave has landed: at least one migration it lists is on disk.
 *
 * @param {string[]} migrations
 * @param {string} root
 * @returns {boolean}
 */
function waveHasLanded(migrations, root) {
  return migrations.some((migration) => existsSync(path.join(root, migration)));
}

/**
 * One wave's problems, split so each rule reads on its own.
 *
 * @param {string} wave
 * @param {unknown} entry
 * @param {Map<string, Record<string, unknown>>} rows
 * @param {string} root
 * @returns {string[]}
 */
function waveProblems(wave, entry, rows, root) {
  if (!isRecord(entry)) {
    return [`${WAVE_GATES}: wave \`${wave}\` is not an object, so it gates nothing.`];
  }
  const gating = stringList(entry.gatingRows);
  const artefacts = landingArtefacts(entry);
  if (gating === null || gating.length === 0) {
    return [
      `${WAVE_GATES}: wave \`${wave}\` names no \`gatingRows\`. A wave with no gating row ` +
        'has no entry condition, which is the state this file exists to end.',
    ];
  }
  if (artefacts === null || artefacts.length === 0) {
    return [
      `${WAVE_GATES}: wave \`${wave}\` names neither \`migrations\` nor \`landedBy\`. Nothing ` +
        'can say whether it has landed, so the gate would never fire.',
    ];
  }
  return [...gatingProblems(wave, gating, rows), ...landingProblems(wave, artefacts, root)];
}

/**
 * The files that put a wave on disk, from either field.
 *
 * **One rule, two spellings of the artefact.** `migrations` is what a wave that changes the
 * database names. `landedBy` is for a wave that changes nothing at the schema level and is
 * still gated — Wave 0 unified the two ingestion systems and added no table, and
 * `RF-5`'s rehearsal has still never run, so naming a migration for it would mean either
 * inventing one or lying about the rehearsal having happened. It is not a second landing
 * mechanism: `landedWaves` reads the union through the same predicate.
 *
 * @param {Record<string, unknown>} entry the wave entry
 * @returns {string[] | null} `null` when neither field names a usable list
 */
function landingArtefacts(entry) {
  const migrations = stringList(entry.migrations);
  const landedBy = stringList(entry.landedBy);
  if (migrations !== null && migrations.length > 0) {
    return [...migrations, ...(landedBy ?? [])];
  }
  return landedBy;
}

/**
 * Each gating row must be a row this ledger has.
 *
 * @param {string} wave
 * @param {string[]} gating
 * @param {Map<string, Record<string, unknown>>} rows
 * @returns {string[]}
 */
function gatingProblems(wave, gating, rows) {
  return gating
    .filter((id) => !rows.has(id))
    .map(
      (id) =>
        `${WAVE_GATES}: wave \`${wave}\` is gated on \`${id}\`, which is not a ledger row. A ` +
        'gate on a row that does not exist is a gate that cannot fail.',
    );
}

/**
 * Every migration listed must exist.
 *
 * Not a formality: a list naming a file that was never written reports a wave as
 * gated on nothing at all, which is the same failure as having no entry condition
 * with an extra step.
 *
 * @param {string} wave
 * @param {string[]} artefacts
 * @param {string} root
 * @returns {string[]}
 */
function landingProblems(wave, artefacts, root) {
  return artefacts
    .filter((artefact) => !existsSync(path.join(root, artefact)))
    .map(
      (artefact) =>
        `${WAVE_GATES}: wave \`${wave}\` lists \`${artefact}\`, which does not exist. A ` +
        'migration or landing artefact that was renamed or deleted leaves the gate ' +
        'describing a wave that was never here.',
    );
}

/**
 * Every `blocksWave` must name a wave this file declares.
 *
 * The inverse check, and the one that keeps the field honest: `blocksWave` is a row
 * saying *I block this wave*, so a row naming a wave nothing tracks is asserting a
 * block over nothing — which is exactly the shape of the defect this replaced.
 *
 * @param {Map<string, Record<string, unknown>>} rows
 * @param {Record<string, unknown>} waves
 * @returns {string[]}
 */
function blocksWaveProblems(rows, waves) {
  const declared = Object.keys(waves);
  /** @type {string[]} */
  const findings = [];
  for (const [id, row] of rows) {
    if (!filled(row.blocksWave)) continue;
    if (!declared.includes(/** @type {string} */ (row.blocksWave))) {
      findings.push(
        `${id}: \`blocksWave\` is \`${String(row.blocksWave)}\`, which ${WAVE_GATES} does not ` +
          'declare. A row that blocks a wave nothing tracks blocks nothing.',
      );
    }
  }
  return findings;
}

/**
 * The waves that have landed: at least one artefact each names is on disk.
 *
 * Reads `migrations` and `landedBy` through `landingArtefacts`, so the audit and this
 * function cannot disagree about what a wave declares — and neither can the merge gate,
 * which imports this rather than reimplementing it, because the two have to agree about
 * what "landed" means or one will report a wave as blocked while the other reports it
 * clear. An unreadable manifest yields no waves, and each caller turns that into its own
 * honest outcome — `not_configured` for the merge gate, a finding for the ledger audit.
 *
 * @param {unknown} gates parsed `wave-gates.json`, or `null`
 * @param {{ root: string }} options
 * @returns {string[]}
 */
export function landedWaves(gates, options) {
  if (!isRecord(gates) || !isRecord(gates.waves)) return [];
  const waves = /** @type {Record<string, unknown>} */ (gates.waves);
  const landed = [];
  for (const [wave, entry] of Object.entries(waves)) {
    if (!isRecord(entry)) continue;
    const artefacts = landingArtefacts(entry);
    if (artefacts !== null && waveHasLanded(artefacts, options.root)) landed.push(wave);
  }
  return landed;
}

/**
 * Reads the wave gates, or `null` when the file is absent or unreadable.
 *
 * `null` rather than a throw, because the caller has to report *unreadable* rather
 * than crash: `findings-check.mjs` and the merge gate both treat a policy they cannot
 * read as `not_configured`, which is the outcome this repository uses everywhere else
 * for "I could not look".
 *
 * @param {string} [relative]
 * @returns {unknown}
 */
export function readWaveGates(relative = WAVE_GATES) {
  const file = path.join(repoRoot(), relative);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Audits the wave gates against the ledger and the tree.
 *
 * @param {unknown} gates parsed `wave-gates.json`, or `null`
 * @param {unknown} ledger parsed `findings-ledger.json`
 * @param {{ root: string }} options
 * @returns {string[]}
 */
export function auditWaveGates(gates, ledger, options) {
  if (!isRecord(gates) || !isRecord(gates.waves)) {
    return [
      `${WAVE_GATES} could not be read, so no wave gate could be checked. A gate that ` +
        'cannot read its policy must not report the policy as satisfied.',
    ];
  }
  const rows = rowsById(ledger);
  const waves = /** @type {Record<string, unknown>} */ (gates.waves);
  /** @type {string[]} */
  const findings = [];
  for (const [wave, entry] of Object.entries(waves)) {
    findings.push(...waveProblems(wave, entry, rows, options.root));
  }
  findings.push(...blocksWaveProblems(rows, waves));
  return findings;
}
