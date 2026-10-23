/**
 * Consistency checks for the AUTOMATE (local) blueprint under `docs/local/`.
 *
 * **What this is, and what it is not.** It checks that the blueprint documents agree
 * with each other and with the records they cite: that each has its header, that each
 * ADR it cites exists and is indexed, and (as the set grows) that identifiers defined in
 * one document resolve in another. It does **not** prove that a conclusion is correct. A
 * competitor claim being cited to a dated source is checkable here; the claim being
 * right is not, which is why the data-quality checks live beside the fixtures that
 * exercise them and not in this file.
 *
 * **Why it is a separate module and not a tenth `docs-drift` assertion.** The assertion
 * count in `docs-drift.test.mjs` is pinned at nine and the file says a tenth is a
 * decision to record. These checks are about the structure between one family of
 * documents, not about a claim made against the code, so they do not belong in that
 * list.
 *
 * **Why it reads `docs/local` directly instead of reusing `collectDriftEnvironment`.**
 * That function takes a repository-wide file index, and `indexFiles` walks every
 * directory it can see; on a host where one directory is unreadable it throws before a
 * single document is read. These checks need one directory and the ADR folder, so they
 * read exactly those and nothing else.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** @typedef {{ path: string, text: string }} BlueprintDocument */
/**
 * @typedef {{ id: string, file?: string, generator?: string, kind: string,
 *   provenance: Record<string, string | null | undefined> }} FixtureEntry
 * @typedef {{ manifest: FixtureEntry[], goldens: Record<string, unknown>, files: string[] }} FixtureCorpus
 * @typedef {{ docs: BlueprintDocument[], adrFiles: string[], adrIndex: string,
 *   fixtures: FixtureCorpus, contractStatuses: string[],
 *   exists: (repoRelativePath: string) => boolean, kpiMetricIds: string[] }} BlueprintCorpus
 */

/** The values a document's `**Status:**` may take. */
export const DOCUMENT_STATUSES = ['Draft', 'Proposed', 'Accepted'];

const HEADER_FIELDS = ['Status', 'Owner', 'Last reviewed'];

/**
 * Every markdown file under `docs/local`, the ADR file names, and the ADR index.
 *
 * @param {string} root repository root
 * @returns {BlueprintCorpus}
 */
export function readBlueprintCorpus(root) {
  /** @type {BlueprintDocument[]} */
  const docs = [];
  const base = path.join(root, 'docs', 'local');
  /** @param {string} relative */
  const walk = (relative) => {
    const directory = path.join(base, relative);
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md')) {
        docs.push({
          path: `docs/local/${child}`,
          text: readFileSync(path.join(base, child), 'utf8'),
        });
      }
    }
  };
  walk('');
  docs.sort((left, right) => left.path.localeCompare(right.path));

  const adrDirectory = path.join(root, 'docs', 'adr');
  const adrFiles = existsSync(adrDirectory)
    ? readdirSync(adrDirectory).filter((name) => /^\d{3}-.+\.md$/.test(name))
    : [];
  const indexPath = path.join(adrDirectory, 'README.md');
  const adrIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  return {
    docs,
    adrFiles,
    adrIndex,
    fixtures: readFixtureCorpus(root),
    contractStatuses: readContractStatuses(root),
    exists: (repoRelativePath) => existsSync(path.join(root, repoRelativePath)),
    kpiMetricIds: readKpiMetricIds(root),
  };
}

/**
 * The spike's fixture manifest, goldens and file list.
 *
 * @param {string} root
 * @returns {FixtureCorpus}
 */
function readFixtureCorpus(root) {
  const corpusDir = path.join(root, 'local', 'corpus');
  /** @param {string} name @param {unknown} fallback */
  const readJson = (name, fallback) => {
    const file = path.join(corpusDir, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  };
  const filesDir = path.join(corpusDir, 'files');
  return {
    manifest: readJson('manifest.json', []),
    goldens: readJson('goldens.json', {}),
    files: existsSync(filesDir) ? readdirSync(filesDir) : [],
  };
}

/**
 * The status values of the server contract, read from the schema source rather than typed
 * here, so a value added to the contract changes this list without anyone editing it.
 *
 * @param {string} root
 * @returns {string[]}
 */
function readContractStatuses(root) {
  const file = path.join(
    root,
    'packages',
    'shared-contracts',
    'src',
    'schemas',
    'canonical-reporting.ts',
  );
  if (!existsSync(file)) return [];
  const block = /const StatusSchema = z\.enum\(\[([\s\S]*?)\]\);/.exec(readFileSync(file, 'utf8'));
  if (block === null) return [];
  const code = (block[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...code.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1] ?? '');
}

/**
 * The metric ids the reporting policy computes, read from its source so the KPI dictionary
 * has to account for each of them.
 *
 * @param {string} root
 * @returns {string[]}
 */
function readKpiMetricIds(root) {
  const file = path.join(root, 'packages', 'reporting', 'src', 'kpi.ts');
  if (!existsSync(file)) return [];
  return [
    ...new Set(
      [...readFileSync(file, 'utf8').matchAll(/metric:\s*'([a-z0-9-]+)'/g)].map(
        (match) => match[1] ?? '',
      ),
    ),
  ];
}
/**
 * The control arm: the collector reached the documents.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkCorpusReachable(corpus) {
  if (corpus.docs.length === 0) {
    return ['docs/local has no documents, so the blueprint checks are vacuous'];
  }
  if (!corpus.docs.some((doc) => doc.path === 'docs/local/README.md')) {
    return ['docs/local/README.md is missing, so there is no index and no claim vocabulary'];
  }
  return [];
}

/**
 * The text of one `**Field:** value` line, or `null`.
 *
 * @param {string} text
 * @param {string} field
 * @returns {string | null}
 */
function headerValue(text, field) {
  const head = text.split(/\r?\n/).slice(0, 30);
  for (const line of head) {
    const prefix = `**${field}:**`;
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

/**
 * Whether a string is a calendar date in `YYYY-MM-DD` form.
 *
 * Round-tripped through `Date` because a pattern alone accepts `2026-13-45`.
 *
 * @param {string} value
 */
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Every document carries Status, Owner and Last reviewed within its first lines.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkHeaders(corpus) {
  /** @type {string[]} */
  const findings = [];
  for (const doc of corpus.docs) {
    for (const field of HEADER_FIELDS) {
      const problem = headerProblem(doc, field);
      if (problem !== null) findings.push(problem);
    }
  }
  return findings;
}

/**
 * What is wrong with one header field of one document, or null. Missing beats malformed.
 *
 * @param {{ path: string, text: string }} doc
 * @param {string} field
 * @returns {string | null}
 */
function headerProblem(doc, field) {
  const value = headerValue(doc.text, field);
  if (value === null || value === '') return `${doc.path}: header is missing \`**${field}:**\``;
  if (field === 'Status' && !DOCUMENT_STATUSES.includes(value)) {
    return `${doc.path}: \`**Status:**\` must be one of ${DOCUMENT_STATUSES.join(', ')}; got \`${value}\``;
  }
  if (field === 'Last reviewed' && !isIsoDate(value)) {
    return `${doc.path}: \`**Last reviewed:**\` must be an ISO date; got \`${value}\``;
  }
  return null;
}

/**
 * Every `ADR-nnn` cited under `docs/local` has a file and a row in the ADR index.
 *
 * `docs-drift` already fails a citation with no file. The index-row half is new: the
 * ADR README says the index is the only place a number is claimed, and nothing checked
 * it.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkAdrReferences(corpus) {
  /** @type {string[]} */
  const findings = [];
  const filed = new Set(corpus.adrFiles.map((name) => name.slice(0, 3)));
  const indexed = new Set(
    [...corpus.adrIndex.matchAll(/^\|\s*\[ADR-(\d{3})\]/gm)].map((match) => match[1] ?? ''),
  );
  for (const doc of corpus.docs) {
    const cited = new Set([...doc.text.matchAll(/ADR-(\d{3})/g)].map((match) => match[1] ?? ''));
    for (const number of [...cited].sort()) {
      if (!filed.has(number)) {
        findings.push(
          `${doc.path}: cites ADR-${number}, which has no file docs/adr/${number}-*.md`,
        );
      } else if (!indexed.has(number)) {
        findings.push(
          `${doc.path}: cites ADR-${number}, which has a file but no row in docs/adr/README.md`,
        );
      }
    }
  }
  return findings;
}

/**
 * Provenance, golden and file problems of one manifest entry.
 *
 * @param {FixtureEntry} entry
 * @param {FixtureCorpus} fixtures
 * @returns {string[]}
 */
function fixtureEntryProblems(entry, fixtures) {
  /** @type {string[]} */
  const findings = [];
  for (const field of ['origin', 'licence', 'generation', 'date']) {
    if (!entry.provenance?.[field])
      findings.push(`fixture ${entry.id}: provenance.${field} is missing`);
  }
  if (entry.kind === 'real-tool-output') {
    for (const field of ['tool', 'toolVersion', 'postProcessing']) {
      if (!entry.provenance?.[field]) {
        findings.push(`fixture ${entry.id}: real tool output must record provenance.${field}`);
      }
    }
  }
  if (!Object.hasOwn(fixtures.goldens, entry.id)) {
    findings.push(`fixture ${entry.id}: has no golden in goldens.json`);
  }
  if (entry.file !== undefined && !fixtures.files.includes(entry.file)) {
    findings.push(`fixture ${entry.id}: file ${entry.file} does not exist in corpus/files`);
  }
  return findings;
}

/**
 * Every corpus file a manifest entry accounts for, its own and its companions'.
 *
 * @param {FixtureEntry} entry
 * @returns {string[]}
 */
function fixtureReferencedFiles(entry) {
  const companions = /** @type {{ companions?: string[] }} */ (entry).companions ?? [];
  return [...(entry.file === undefined ? [] : [entry.file]), ...companions];
}

/**
 * Every fixture has provenance and a golden, every golden has a fixture, and every file in
 * the corpus is accounted for.
 *
 * This is structure only. Whether a golden is *right* is what the spike's own tests, run
 * against the parsers, establish.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkFixtureCorpus(corpus) {
  const { manifest, goldens, files } = corpus.fixtures;
  if (manifest.length === 0) {
    return ['local/corpus has no fixtures, so the data-quality checks are vacuous'];
  }
  const referenced = new Set(manifest.flatMap(fixtureReferencedFiles));
  const ids = new Set(manifest.map((entry) => entry.id));
  return [
    ...manifest.flatMap((entry) => fixtureEntryProblems(entry, corpus.fixtures)),
    ...Object.keys(goldens)
      .filter((id) => !ids.has(id))
      .map((id) => `goldens.json: golden ${id} has no manifest entry`),
    ...files
      .filter((file) => !referenced.has(file))
      .map((file) => `corpus/files/${file}: not referenced by any manifest entry`),
  ];
}

/**
 * `docs/local/data-contracts.md` lists exactly the server contract's statuses in its
 * mapping table.
 *
 * Two arms, as in `docs-drift`: the derived list is non-empty (or an empty list would make
 * any table correct), and the table agrees with it in both directions. A document that
 * does not exist yet is not a finding; the check starts to bind when the document does.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkStatusMapping(corpus) {
  if (corpus.contractStatuses.length === 0) {
    return [
      'the contract status list could not be derived from canonical-reporting.ts, so the mapping check is vacuous',
    ];
  }
  const doc = corpus.docs.find((candidate) => candidate.path === 'docs/local/data-contracts.md');
  if (doc === undefined) return [];
  const section = doc.text
    .split(/^## /m)
    .find((part) => part.startsWith('Mapping from the server contract'));
  const listed = [...(section ?? '').matchAll(/^\|\s*`([A-Za-z]+)`\s*\|/gm)].map(
    (match) => match[1] ?? '',
  );
  /** @type {string[]} */
  const findings = [];
  for (const status of corpus.contractStatuses) {
    if (!listed.includes(status)) {
      findings.push(`${doc.path}: mapping table is missing the contract status \`${status}\``);
    }
  }
  for (const status of listed) {
    if (!corpus.contractStatuses.includes(status)) {
      findings.push(
        `${doc.path}: mapping table lists \`${status}\`, which the contract does not have`,
      );
    }
  }
  return findings;
}

/** The verdicts a feasibility row may carry. */
export const FEASIBILITY_VERDICTS = ['go', 'adjust', 'no-go'];

/**
 * Resolves a link target found in `fromDoc` to a repository-relative path.
 *
 * @param {string} fromDoc repository-relative path of the document
 * @param {string} target the link target, possibly with an anchor
 * @returns {string | null} null for an external or anchor-only target
 */
function resolveLink(fromDoc, target) {
  if (/^(?:[a-z]+:|#|\/)/i.test(target)) return null;
  const withoutAnchor = target.split('#')[0] ?? '';
  if (withoutAnchor === '') return null;
  /** @type {string[]} */
  const segments = [];
  for (const segment of [...fromDoc.split('/').slice(0, -1), ...withoutAnchor.split('/')]) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

/**
 * Every row of the feasibility document's verdict table has a verdict from the fixed
 * vocabulary and links evidence that exists.
 *
 * It does not judge whether the evidence supports the verdict. It stops a verdict being
 * written with nothing behind it, or with a link left pointing at a file that was removed.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkFeasibility(corpus) {
  const doc = corpus.docs.find((candidate) => candidate.path === 'docs/local/feasibility.md');
  if (doc === undefined) return [];
  const section = doc.text.split(/^## /m).find((part) => part.startsWith('Verdicts'));
  const rows = (section ?? '')
    .split('\n')
    .filter((line) => /^\|\s*RISK-\d+\s*\|/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  if (rows.length === 0) {
    return [`${doc.path}: the Verdicts table has no risk rows, so the check is vacuous`];
  }
  /** @type {string[]} */
  const findings = [];
  for (const cells of rows) {
    const id = cells[0] ?? '';
    const verdict = (cells[2] ?? '').replace(/`/g, '');
    if (!FEASIBILITY_VERDICTS.includes(verdict)) {
      findings.push(
        `${doc.path}: ${id} has verdict \`${verdict}\`; it must be ${FEASIBILITY_VERDICTS.slice(
          0,
          -1,
        ).join(', ')} or ${FEASIBILITY_VERDICTS.at(-1) ?? ''}`,
      );
    }
    const targets = [...(cells[3] ?? '').matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => resolveLink(doc.path, match[1] ?? ''))
      .filter((target) => target !== null);
    if (targets.length === 0) findings.push(`${doc.path}: ${id} links no evidence`);
    for (const target of targets) {
      if (!corpus.exists(target ?? '')) {
        findings.push(`${doc.path}: ${id} cites ${target ?? ''}, which does not exist`);
      }
    }
  }
  return findings;
}

/** The classes a source-register row may carry. */
export const SOURCE_CLASSES = ['verified', 'vendor-claim'];

/**
 * The source register, and every citation of it.
 *
 * Rules: each row has an https URL, an ISO access date and a class from the register
 * vocabulary; ids are unique; every `S-nn` cited in another `docs/local` document is in the
 * register; and a table cell that cites a vendor-claim source says it is claimed, so a
 * comparison matrix cannot present a vendor's statement as a verified fact.
 *
 * It checks the shape of the evidence trail. It does not check that a source says what the
 * document says it does; that is review.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkSources(corpus) {
  const register = corpus.docs.find((doc) => doc.path === 'docs/local/research/sources.md');
  if (register === undefined) return [];
  const rows = register.text
    .split('\n')
    .filter((line) => /^\|\s*S-\d+\s*\|/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  if (rows.length === 0) {
    return [`${register.path}: the register has no rows, so the checks are vacuous`];
  }
  const { findings, classes } = sourceRegisterProblems(register.path, rows);
  for (const doc of corpus.docs) {
    if (doc.path === register.path) continue;
    findings.push(...unregisteredCitations(doc, classes), ...unclaimedVendorCells(doc, classes));
  }
  return findings;
}

/**
 * The problems in the register's own rows, and the class of each id for the citation checks.
 *
 * @param {string} registerPath
 * @param {string[][]} rows
 * @returns {{ findings: string[], classes: Map<string, string> }}
 */
function sourceRegisterProblems(registerPath, rows) {
  /** @type {string[]} */
  const findings = [];
  /** @type {Map<string, string>} */
  const classes = new Map();
  for (const [id = '', url = '', , accessed = '', cls = ''] of rows) {
    if (classes.has(id)) findings.push(`${registerPath}: ${id} is defined more than once`);
    classes.set(id, cls);
    if (!url.startsWith('https://')) findings.push(`${registerPath}: ${id} must have an https URL`);
    if (!isIsoDate(accessed)) {
      findings.push(`${registerPath}: ${id} must have an ISO access date; got \`${accessed}\``);
    }
    if (!SOURCE_CLASSES.includes(cls)) {
      findings.push(
        `${registerPath}: ${id} has class \`${cls}\`; it must be ${SOURCE_CLASSES.join(' or ')}`,
      );
    }
  }
  return { findings, classes };
}

/**
 * The distinct `S-nn` ids cited in a piece of text.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function citedSourceIds(text) {
  return new Set([...text.matchAll(/\bS-\d{2}\b/g)].map((match) => match[0]));
}

/**
 * Citations of ids the register does not define.
 *
 * @param {BlueprintDocument} doc
 * @param {Map<string, string>} classes
 * @returns {string[]}
 */
function unregisteredCitations(doc, classes) {
  return [...citedSourceIds(doc.text)]
    .filter((cited) => !classes.has(cited))
    .map((cited) => `${doc.path}: cites ${cited}, which is not in the source register`);
}

/**
 * Table cells that cite a vendor-claim source without saying it is claimed. A cell holding
 * only source ids is a citation column, not an assertion.
 *
 * @param {BlueprintDocument} doc
 * @param {Map<string, string>} classes
 * @returns {string[]}
 */
function unclaimedVendorCells(doc, classes) {
  /** @type {string[]} */
  const findings = [];
  for (const line of doc.text.split('\n').filter((candidate) => candidate.startsWith('|'))) {
    for (const cited of citedSourceIds(line)) {
      if (classes.get(cited) !== 'vendor-claim') continue;
      const assertingCells = line
        .split('|')
        .filter((cell) => cell.includes(cited))
        .filter((cell) => cell.replace(/S-\d{2}|[,\s]/g, '') !== '');
      if (assertingCells.some((cell) => !/claimed/i.test(cell))) {
        findings.push(
          `${doc.path}: a table cell cites vendor-claim source ${cited} without saying \`claimed\``,
        );
      }
    }
  }
  return findings;
}

// ── Structure of the content documents ──────────────────────────────────────────────────
//
// Each check below is about shape: that an identifier is defined once, that a record has
// the fields it must have, that a reference resolves. None judges whether the content is
// right; that is what review and the tests the documents point at are for.

/**
 * @param {BlueprintCorpus} corpus
 * @param {string} docPath
 */
function findDoc(corpus, docPath) {
  return corpus.docs.find((candidate) => candidate.path === docPath);
}

/**
 * The cells of every table row whose first cell matches an identifier pattern.
 *
 * @param {string} text
 * @param {RegExp} idPattern anchored to the whole first cell
 * @returns {string[][]}
 */
function rowsWithId(text, idPattern) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => idPattern.test(cells[0] ?? ''));
}

/**
 * The paragraph of bold-labelled text that follows `**Label.**`, joined onto one line.
 *
 * @param {string} body
 * @param {string} label
 * @returns {string | null} null when the label is absent
 */
function labelled(body, label) {
  const start = body.indexOf(`**${label}.**`);
  if (start === -1) return null;
  const rest = body.slice(start + label.length + 5);
  const end = rest.search(/\n\s*\n/);
  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, ' ').trim();
}

/**
 * Splits text at lines that start with a heading prefix, dropping the preamble.
 *
 * @param {string} text
 * @param {string} prefix for example `### `
 * @returns {Array<{ heading: string, body: string }>}
 */
function sectionsAt(text, prefix) {
  const marker = new RegExp(`^${prefix}`, 'm');
  const parts = text.split(new RegExp(`^(?=${prefix})`, 'm')).filter((part) => marker.test(part));
  return parts.map((part) => {
    const newline = part.indexOf('\n');
    return {
      heading: part.slice(prefix.length, newline === -1 ? undefined : newline).trim(),
      body: newline === -1 ? '' : part.slice(newline + 1),
    };
  });
}

const PHASES = ['0', '1', '2', '3', '4', '5'];

/**
 * Requirements: unique ids, a phase, a persona that exists, a criterion, and entities the
 * data contracts describe.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkRequirements(corpus) {
  const prd = findDoc(corpus, 'docs/local/prd.md');
  if (prd === undefined) return [];
  const rows = rowsWithId(prd.text, /^R-\d{3}$/);
  if (rows.length === 0) {
    return [`${prd.path}: the requirements table has no rows, so the checks are vacuous`];
  }
  const users = findDoc(corpus, 'docs/local/users-and-workflows.md');
  const personas =
    users === undefined ? null : new Set(rowsWithId(users.text, /^P-\d$/).map((cells) => cells[0]));
  const seen = new Set();
  const findings = rows.flatMap((row) => {
    const problems = requirementRowProblems(prd.path, row, seen.has(row[0] ?? ''), personas);
    seen.add(row[0] ?? '');
    return problems;
  });
  return [...findings, ...entityProblems(prd, findDoc(corpus, 'docs/local/data-contracts.md'))];
}

/**
 * The problems in one requirement row.
 *
 * @param {string} prdPath
 * @param {string[]} row
 * @param {boolean} duplicate whether the id was already defined
 * @param {Set<string | undefined> | null} personas null when the personas document is absent
 * @returns {string[]}
 */
function requirementRowProblems(prdPath, row, duplicate, personas) {
  const [id = '', requirement = '', phase = '', mvp = '', persona = '', criterion = ''] = row;
  /** @type {string[]} */
  const findings = [];
  if (duplicate) findings.push(`${prdPath}: ${id} is defined more than once`);
  if (requirement === '') findings.push(`${prdPath}: ${id} has no requirement text`);
  if (!PHASES.includes(phase)) {
    findings.push(`${prdPath}: ${id} has phase \`${phase}\`; it must be 0 to 5`);
  }
  if (!['yes', 'no'].includes(mvp)) {
    findings.push(`${prdPath}: ${id} has MVP-0 \`${mvp}\`; it must be yes or no`);
  }
  for (const named of personas === null ? [] : (persona.match(/P-\d+/g) ?? [])) {
    if (!personas?.has(named)) {
      findings.push(
        `${prdPath}: ${id} names persona ${named}, which users-and-workflows.md does not define`,
      );
    }
  }
  if (criterion === '') findings.push(`${prdPath}: ${id} has no acceptance criterion`);
  return findings;
}

/**
 * Entities the PRD names for the first slice that the data contracts do not describe.
 *
 * @param {BlueprintDocument} prd
 * @param {BlueprintDocument | undefined} contracts
 * @returns {string[]}
 */
function entityProblems(prd, contracts) {
  const entitySection = sectionsAt(prd.text, '## ').find(
    (s) => s.heading === 'Entities in the first slice',
  );
  if (contracts === undefined || entitySection === undefined) return [];
  const sentence = entitySection.body.replace(/\s+/g, ' ').trim().split('.')[0] ?? '';
  return sentence
    .split(/,\s*|\s+and\s+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((entity) => !contracts.text.includes(entity))
    .map((entity) => `${prd.path}: entity ${entity} is not described in data-contracts.md`);
}

const KPI_FIELDS = [
  'Definition',
  'Formula',
  'Source data',
  'Applicability',
  'Freshness',
  'Missing data',
  'Origin',
  'Limitations',
  'Presentation',
  'Validation',
];

/**
 * KPIs: ten fields each (or preconditions when planned), unique ids, real fixtures, every
 * metric the reporting policy computes accounted for, and interface citations that resolve.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkKpis(corpus) {
  const dictionary = findDoc(corpus, 'docs/local/kpi-dictionary.md');
  if (dictionary === undefined) return [];
  const sections = sectionsAt(dictionary.text, '### ').filter((s) => /K-\d+/.test(s.heading));
  if (sections.length === 0) {
    return [`${dictionary.path}: no KPI sections found, so the checks are vacuous`];
  }
  const fixtureIds = new Set(corpus.fixtures.manifest.map((entry) => entry.id));
  /** @type {string[]} */
  const findings = [];
  /** @type {Set<string>} */
  const defined = new Set();
  for (const { heading, body } of sections) {
    const ids = heading.match(/K-\d+/g) ?? [];
    for (const id of ids) {
      if (defined.has(id)) findings.push(`${dictionary.path}: ${id} is defined more than once`);
      defined.add(id);
    }
    findings.push(...kpiSectionProblems(dictionary.path, ids[0] ?? '', body, fixtureIds));
  }
  const unadopted = corpus.kpiMetricIds.filter(
    (metric) => !dictionary.text.includes(`\`${metric}\``),
  );
  findings.push(
    ...unadopted.map(
      (metric) =>
        `${dictionary.path}: the reporting metric \`${metric}\` is neither adopted nor marked not adopted`,
    ),
  );
  findings.push(...undefinedKpiCitations(findDoc(corpus, 'docs/local/ux-spec.md'), defined));
  return findings;
}

/**
 * Every KPI the UX spec cites that the dictionary does not define.
 *
 * @param {{ path: string, text: string } | undefined} ux
 * @param {Set<string>} defined
 * @returns {string[]}
 */
function undefinedKpiCitations(ux, defined) {
  return [...new Set(ux?.text.match(/\bK-\d{2}\b/g) ?? [])]
    .filter((cited) => !defined.has(cited))
    .map((cited) => `${ux?.path ?? ''}: cites ${cited}, which the KPI dictionary does not define`);
}

/**
 * The problems in one KPI section: a planned one needs preconditions, an adopted one needs
 * every field and validates only against corpus fixtures.
 *
 * @param {string} dictionaryPath
 * @param {string} primary the section's first K-id
 * @param {string} body
 * @param {Set<string>} fixtureIds
 * @returns {string[]}
 */
function kpiSectionProblems(dictionaryPath, primary, body, fixtureIds) {
  if (/\*\*Status:\*\*\s*Planned/.test(body)) {
    return labelled(body, 'Preconditions') === null
      ? [`${dictionaryPath}: ${primary} is planned and states no \`Preconditions\``]
      : [];
  }
  const missing = KPI_FIELDS.filter((field) => labelled(body, field) === null).map(
    (field) => `${dictionaryPath}: ${primary} is missing the field \`${field}\``,
  );
  // A hyphenated id, matched flat and then checked: a repeated group around a repeated class
  // is the shape `security/detect-unsafe-regex` refuses.
  const validation = [...(labelled(body, 'Validation') ?? '').matchAll(/`([a-z0-9-]+)`/g)]
    .map((token) => token[1] ?? '')
    .filter((id) => id.split('-').length > 1 && id.split('-').every((part) => part !== ''))
    .filter((id) => !fixtureIds.has(id))
    .map(
      (id) =>
        `${dictionaryPath}: ${primary} validates against \`${id}\`, which is not a corpus fixture`,
    );
  return [...missing, ...validation];
}

/**
 * Threats: each has a mitigation or an accepted risk, and an owner for what remains; every
 * citation of a threat elsewhere resolves.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkThreats(corpus) {
  const model = findDoc(corpus, 'docs/local/runner-and-threat-model.md');
  if (model === undefined) return [];
  const rows = rowsWithId(model.text, /^T-\d{2}$/);
  if (rows.length === 0)
    return [`${model.path}: the threat table has no rows, so the check is vacuous`];
  /** @type {string[]} */
  const findings = [];
  for (const [id = '', , mitigation = '', , residual = ''] of rows) {
    if (mitigation === '')
      findings.push(`${model.path}: ${id} states no mitigation or accepted risk`);
    if (!/owner/i.test(residual))
      findings.push(`${model.path}: ${id} names no owner for its residual risk`);
  }
  const defined = new Set(rows.map((cells) => cells[0]));
  for (const doc of corpus.docs) {
    if (doc.path !== model.path) findings.push(...undefinedThreatCitations(doc, defined));
  }
  return findings;
}

/**
 * Every threat a document cites that the threat model does not define.
 *
 * @param {{ path: string, text: string }} doc
 * @param {Set<string | undefined>} defined
 * @returns {string[]}
 */
function undefinedThreatCitations(doc, defined) {
  return [...new Set(doc.text.match(/\bT-\d{2}\b/g) ?? [])]
    .filter((cited) => !defined.has(cited))
    .map((cited) => `${doc.path}: cites ${cited}, which the threat model does not define`);
}

/**
 * Screens: each states loading, empty, error, partial and success.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkUx(corpus) {
  const ux = findDoc(corpus, 'docs/local/ux-spec.md');
  if (ux === undefined) return [];
  const screens = sectionsAt(ux.text, '### Screen: ');
  if (screens.length === 0) return [`${ux.path}: no screens found, so the check is vacuous`];
  /** @type {string[]} */
  const findings = [];
  for (const { heading, body } of screens) {
    for (const state of ['Loading', 'Empty', 'Error', 'Partial', 'Success']) {
      if (labelled(body, state) === null) {
        findings.push(`${ux.path}: screen ${heading} does not state \`${state}\``);
      }
    }
  }
  return findings;
}

const PHASE_FIELDS = [
  'User value',
  'Scope',
  'Requirements',
  'Dependencies',
  'Deliverables',
  'Acceptance criteria',
  'Risks',
  'Validation',
  'Exit criteria',
  'Deferred',
];

/**
 * Roadmap: every phase has its fields, and the requirements it lists are exactly the ones
 * the PRD assigns to that phase.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkRoadmap(corpus) {
  const roadmap = findDoc(corpus, 'docs/local/roadmap.md');
  if (roadmap === undefined) return [];
  const prd = findDoc(corpus, 'docs/local/prd.md');
  const planned = new Map(
    rowsWithId(prd?.text ?? '', /^R-\d{3}$/).map((cells) => [cells[0] ?? '', cells[2] ?? '']),
  );
  const phases = new Map(
    sectionsAt(roadmap.text, '## Phase ').map(({ heading, body }) => [
      heading.split(':')[0] ?? '',
      body,
    ]),
  );
  /** @type {string[]} */
  const findings = [];
  /** @type {Map<string, string>} */
  const scheduled = new Map();
  for (const phase of PHASES) {
    const body = phases.get(phase);
    findings.push(
      ...(body === undefined
        ? [`${roadmap.path}: phase ${phase} is missing`]
        : roadmapPhaseProblems(roadmap.path, phase, body, planned, scheduled)),
    );
  }
  for (const [id, phase] of planned) {
    const where = scheduled.get(id);
    if (where === undefined) findings.push(`${roadmap.path}: ${id} is not scheduled in any phase`);
    else if (where !== phase) {
      findings.push(
        `${roadmap.path}: ${id} is scheduled in phase ${where} but the PRD says phase ${phase}`,
      );
    }
  }
  return findings;
}

/**
 * The problems in one roadmap phase; records the requirements it lists in `scheduled`.
 *
 * @param {string} roadmapPath
 * @param {string} phase
 * @param {string} body
 * @param {Map<string, string>} planned requirement id to the phase the PRD assigns
 * @param {Map<string, string>} scheduled requirement id to the phase that lists it
 * @returns {string[]}
 */
function roadmapPhaseProblems(roadmapPath, phase, body, planned, scheduled) {
  const findings = PHASE_FIELDS.filter((field) => labelled(body, field) === null).map(
    (field) => `${roadmapPath}: phase ${phase} is missing the field \`${field}\``,
  );
  for (const id of labelled(body, 'Requirements')?.match(/R-\d{3}/g) ?? []) {
    if (!planned.has(id)) {
      findings.push(`${roadmapPath}: phase ${phase} lists ${id}, which the PRD does not define`);
    }
    scheduled.set(id, phase);
  }
  return findings;
}

/**
 * The ratings of one scenario that are not Low, Medium or High.
 *
 * @param {string} docPath
 * @param {string} id
 * @param {Array<[string, string]>} ratings name and value pairs
 * @returns {string[]}
 */
function badRatings(docPath, id, ratings) {
  return ratings
    .filter(([, value]) => !['Low', 'Medium', 'High'].includes(value))
    .map(
      ([name, value]) =>
        `${docPath}: ${id} has ${name} \`${value}\`; it must be Low, Medium or High`,
    );
}
/**
 * Failure scenarios: severity and likelihood from a fixed vocabulary, and a stated expected
 * behaviour, recovery and verification for each.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkRisks(corpus) {
  const doc = findDoc(corpus, 'docs/local/risks-and-adversarial-review.md');
  if (doc === undefined) return [];
  const rows = rowsWithId(doc.text, /^F-\d{2}$/);
  if (rows.length === 0) {
    return [`${doc.path}: the scenario table has no rows, so the check is vacuous`];
  }
  /** @type {string[]} */
  const findings = [];
  for (const [
    id = '',
    ,
    severity = '',
    likelihood = '',
    expected = '',
    recovery = '',
    verification = '',
  ] of rows) {
    findings.push(
      ...badRatings(doc.path, id, [
        ['severity', severity],
        ['likelihood', likelihood],
      ]),
    );
    if (expected === '') findings.push(`${doc.path}: ${id} states no expected behaviour`);
    if (recovery === '') findings.push(`${doc.path}: ${id} states no recovery`);
    if (verification === '') findings.push(`${doc.path}: ${id} states no verification`);
  }
  return findings;
}

/**
 * Planned items state a precondition.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkPlanned(corpus) {
  const doc = findDoc(corpus, 'docs/local/toolbox-and-intelligence.md');
  if (doc === undefined) return [];
  /** @type {string[]} */
  const findings = [];
  /** @type {string[] | null} */
  let bullet = null;
  const close = () => {
    if (bullet !== null && !bullet.join(' ').includes('Precondition')) {
      const text = bullet
        .join(' ')
        .replace(/^- Planned:\s*/, '')
        .trim();
      findings.push(
        `${doc.path}: a planned item states no \`Precondition\`: "${text.slice(0, 60)}"`,
      );
    }
    bullet = null;
  };
  for (const line of doc.text.split('\n')) {
    if (line.startsWith('- Planned:')) {
      close();
      bullet = [line];
    } else if (
      bullet !== null &&
      line.trim() !== '' &&
      !line.startsWith('- ') &&
      !line.startsWith('#')
    ) {
      bullet.push(line.trim());
    } else close();
  }
  close();
  return findings;
}

/**
 * Architecture: every row of the decisions table cites an ADR.
 *
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function checkArchitecture(corpus) {
  const doc = findDoc(corpus, 'docs/local/architecture.md');
  if (doc === undefined) return [];
  const section = sectionsAt(doc.text, '## ').find((s) => s.heading === 'Decisions');
  if (section === undefined) return [`${doc.path}: there is no Decisions section`];
  const rows = section.body
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  return rows
    .filter((cells) => !/ADR-\d{3}/.test(cells.join(' ')))
    .map((cells) => `${doc.path}: the decision \`${cells[0] ?? ''}\` cites no ADR`);
}

/**
 * The registered checks, in the order they run. Later tasks append here; a check that is
 * not in this list is not run, which `blueprint-consistency.test.mjs` asserts the other
 * way round.
 *
 * @type {ReadonlyArray<(corpus: BlueprintCorpus) => string[]>}
 */
export const BLUEPRINT_CHECKS = [
  checkCorpusReachable,
  checkHeaders,
  checkAdrReferences,
  checkFixtureCorpus,
  checkStatusMapping,
  checkFeasibility,
  checkSources,
  checkRequirements,
  checkKpis,
  checkThreats,
  checkUx,
  checkRoadmap,
  checkRisks,
  checkPlanned,
  checkArchitecture,
];

/**
 * @param {BlueprintCorpus} corpus
 * @returns {string[]}
 */
export function blueprintFindings(corpus) {
  return BLUEPRINT_CHECKS.flatMap((check) => check(corpus));
}
