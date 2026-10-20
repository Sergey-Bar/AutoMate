import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  BLUEPRINT_CHECKS,
  blueprintFindings,
  checkAdrReferences,
  checkArchitecture,
  checkCorpusReachable,
  checkFeasibility,
  checkFixtureCorpus,
  checkHeaders,
  checkKpis,
  checkPlanned,
  checkRequirements,
  checkRisks,
  checkRoadmap,
  checkSources,
  checkStatusMapping,
  checkThreats,
  checkUx,
  readBlueprintCorpus,
} from './blueprint-consistency.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const GOOD_HEADER = [
  '# A document',
  '',
  '**Status:** Draft',
  '**Owner:** maintainers',
  '**Last reviewed:** 2026-10-19',
  '',
  'Body.',
].join('\n');

const GOOD_PROVENANCE = {
  origin: 'authored here',
  licence: 'MIT (this repository)',
  generation: 'by hand',
  date: '2026-10-19',
};

/**
 * A corpus built in memory, so a detector is proved against the defect it exists to
 * catch rather than against whatever the tree happens to contain today.
 *
 * @param {Record<string, string>} docs
 * @param {{ adrFiles?: string[], adrIndex?: string,
 *   fixtures?: import('./blueprint-consistency.mjs').FixtureCorpus,
 *   contractStatuses?: string[], exists?: (file: string) => boolean,
 *   kpiMetricIds?: string[] }} [extra]
 * @returns {import('./blueprint-consistency.mjs').BlueprintCorpus}
 */
function corpus(docs, extra = {}) {
  return {
    docs: Object.entries(docs).map(([docPath, text]) => ({ path: docPath, text })),
    adrFiles: extra.adrFiles ?? ['007-local-product.md'],
    adrIndex:
      extra.adrIndex ?? '| [ADR-007](./007-local-product.md) | x | proposed | 2026-10-19 | â€” |',
    fixtures: extra.fixtures ?? { manifest: [], goldens: {}, files: [] },
    contractStatuses: extra.contractStatuses ?? [],
    exists: extra.exists ?? (() => true),
    kpiMetricIds: extra.kpiMetricIds ?? [],
  };
}

test('the corpus under docs/local is reachable, or every check below passes on nothing', () => {
  // The control arm. A gate whose collector returns nothing reports a clean repository
  // with a straight face, which is the failure `docs-drift.test.mjs` records for itself.
  assert.deepEqual(checkCorpusReachable(corpus({})), [
    'docs/local has no documents, so the blueprint checks are vacuous',
  ]);
  assert.deepEqual(
    checkCorpusReachable(corpus({ 'docs/local/prd.md': GOOD_HEADER })),
    ['docs/local/README.md is missing, so there is no index and no claim vocabulary'],
    'a corpus without its index is a corpus nobody can navigate',
  );
  assert.deepEqual(checkCorpusReachable(corpus({ 'docs/local/README.md': GOOD_HEADER })), []);
});

test('a document without the Status / Owner / Last reviewed header is a finding', () => {
  assert.deepEqual(checkHeaders(corpus({ 'docs/local/a.md': GOOD_HEADER })), []);

  const noOwner = GOOD_HEADER.replace('**Owner:** maintainers\n', '');
  assert.deepEqual(checkHeaders(corpus({ 'docs/local/a.md': noOwner })), [
    'docs/local/a.md: header is missing `**Owner:**`',
  ]);

  const badStatus = GOOD_HEADER.replace('Draft', 'Done');
  assert.deepEqual(checkHeaders(corpus({ 'docs/local/a.md': badStatus })), [
    'docs/local/a.md: `**Status:**` must be one of Draft, Proposed, Accepted; got `Done`',
  ]);

  const badDate = GOOD_HEADER.replace('2026-10-19', 'yesterday');
  assert.deepEqual(checkHeaders(corpus({ 'docs/local/a.md': badDate })), [
    'docs/local/a.md: `**Last reviewed:**` must be an ISO date; got `yesterday`',
  ]);

  const impossibleDate = GOOD_HEADER.replace('2026-10-19', '2026-13-45');
  assert.deepEqual(checkHeaders(corpus({ 'docs/local/a.md': impossibleDate })), [
    'docs/local/a.md: `**Last reviewed:**` must be an ISO date; got `2026-13-45`',
  ]);
});

test('an ADR cited under docs/local needs a record and an index row', () => {
  /** @param {string | number} n */
  const cites = (n) => corpus({ 'docs/local/a.md': `${GOOD_HEADER}\nSee ADR-${n}.` });

  assert.deepEqual(checkAdrReferences(cites('007')), []);

  assert.deepEqual(checkAdrReferences(cites('099')), [
    'docs/local/a.md: cites ADR-099, which has no file docs/adr/099-*.md',
  ]);

  // A file with no row: the number is claimed nowhere a reader looks.
  assert.deepEqual(
    checkAdrReferences(
      corpus(
        { 'docs/local/a.md': `${GOOD_HEADER}\nSee ADR-008.` },
        { adrFiles: ['007-local-product.md', '008-staged.md'] },
      ),
    ),
    ['docs/local/a.md: cites ADR-008, which has a file but no row in docs/adr/README.md'],
  );
});

test('the fixture corpus needs provenance, a golden, and no orphans', () => {
  /** @param {string} id @param {string | undefined} file @param {Record<string, string | null | undefined>} [provenance] */
  const entry = (id, file, provenance = GOOD_PROVENANCE) => ({
    id,
    file,
    kind: 'handwritten',
    provenance,
  });
  const good = {
    manifest: [entry('a', 'a.xml')],
    goldens: { a: { kind: 'run' } },
    files: ['a.xml'],
  };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: good })), []);

  assert.deepEqual(
    checkFixtureCorpus(corpus({}, { fixtures: { manifest: [], goldens: {}, files: [] } })),
    ['local/corpus has no fixtures, so the data-quality checks are vacuous'],
  );

  const noOrigin = { ...good, manifest: [entry('a', 'a.xml', { ...GOOD_PROVENANCE, origin: '' })] };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: noOrigin })), [
    'fixture a: provenance.origin is missing',
  ]);

  const noGolden = { ...good, goldens: {} };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: noGolden })), [
    'fixture a: has no golden in goldens.json',
  ]);

  const strayGolden = { ...good, goldens: { a: {}, b: {} } };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: strayGolden })), [
    'goldens.json: golden b has no manifest entry',
  ]);

  const orphan = { ...good, files: ['a.xml', 'b.xml'] };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: orphan })), [
    'corpus/files/b.xml: not referenced by any manifest entry',
  ]);

  const missingFile = { ...good, files: [] };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: missingFile })), [
    'fixture a: file a.xml does not exist in corpus/files',
  ]);

  const real = {
    ...good,
    manifest: [{ ...entry('a', 'a.xml'), kind: 'real-tool-output' }],
  };
  assert.deepEqual(checkFixtureCorpus(corpus({}, { fixtures: real })), [
    'fixture a: real tool output must record provenance.tool',
    'fixture a: real tool output must record provenance.toolVersion',
    'fixture a: real tool output must record provenance.postProcessing',
  ]);
});

test('the status mapping table lists exactly the statuses the server contract has', () => {
  /** @param {string[]} rows */
  const table = (rows) =>
    [
      '## Mapping from the server contract',
      '',
      '| Contract status | Local outcome |',
      '| --- | --- |',
      ...rows.map((row) => `| \`${row}\` | passed |`),
    ].join('\n');
  /** @param {string[]} rows */
  const withTable = (rows) =>
    corpus(
      { 'docs/local/data-contracts.md': `${GOOD_HEADER}\n${table(rows)}` },
      {
        contractStatuses: ['passed', 'failed'],
      },
    );

  assert.deepEqual(checkStatusMapping(withTable(['passed', 'failed'])), []);
  assert.deepEqual(checkStatusMapping(withTable(['passed'])), [
    'docs/local/data-contracts.md: mapping table is missing the contract status `failed`',
  ]);
  assert.deepEqual(checkStatusMapping(withTable(['passed', 'failed', 'invented'])), [
    'docs/local/data-contracts.md: mapping table lists `invented`, which the contract does not have',
  ]);

  assert.deepEqual(
    checkStatusMapping(corpus({}, { contractStatuses: [] })),
    [
      'the contract status list could not be derived from canonical-reporting.ts, so the mapping check is vacuous',
    ],
    'an empty derived list must not make every table correct',
  );
});

test('the feasibility verdict table needs a verdict and evidence that exists for every risk', () => {
  /** @param {string[]} rows */
  const doc = (rows) =>
    [
      GOOD_HEADER,
      '## Verdicts',
      '',
      '| ID | Risk | Verdict | Evidence |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
  const present = new Set(['spikes/a.test.mjs']);
  /** @param {string[]} rows */
  const withRows = (rows) =>
    corpus({ 'docs/local/feasibility.md': doc(rows) }, { exists: (file) => present.has(file) });

  assert.deepEqual(
    checkFeasibility(withRows(['| RISK-1 | one | go | [test](../../spikes/a.test.mjs) |'])),
    [],
  );
  assert.deepEqual(
    checkFeasibility(withRows(['| RISK-1 | one | maybe | [test](../../spikes/a.test.mjs) |'])),
    ['docs/local/feasibility.md: RISK-1 has verdict `maybe`; it must be go, adjust or no-go'],
  );
  assert.deepEqual(checkFeasibility(withRows(['| RISK-1 | one | go | nothing linked |'])), [
    'docs/local/feasibility.md: RISK-1 links no evidence',
  ]);
  assert.deepEqual(
    checkFeasibility(withRows(['| RISK-1 | one | go | [gone](../../spikes/missing.mjs) |'])),
    ['docs/local/feasibility.md: RISK-1 cites spikes/missing.mjs, which does not exist'],
  );
  assert.deepEqual(checkFeasibility(withRows([])), [
    'docs/local/feasibility.md: the Verdicts table has no risk rows, so the check is vacuous',
  ]);
  assert.deepEqual(checkFeasibility(corpus({})), [], 'absent until the document is written');
});

test('the source register needs a URL, a date and a class, and citations must resolve', () => {
  /** @param {string[]} rows */
  const sources = (rows) =>
    [
      GOOD_HEADER,
      '| ID | URL | Supports | Accessed | Class |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
  const good = '| S-01 | https://example.org/a | a thing | 2026-10-19 | verified |';
  /** @param {string[]} register @param {string} [other] */
  const withDocs = (register, other = '') =>
    corpus({
      'docs/local/research/sources.md': sources(register),
      ...(other === ''
        ? {}
        : { 'docs/local/research/competitive-landscape.md': `${GOOD_HEADER}\n${other}` }),
    });

  assert.deepEqual(checkSources(withDocs([good])), []);
  assert.deepEqual(
    checkSources(withDocs(['| S-01 | http://example.org/a | x | 2026-10-19 | verified |'])),
    ['docs/local/research/sources.md: S-01 must have an https URL'],
  );
  assert.deepEqual(
    checkSources(withDocs(['| S-01 | https://example.org/a | x | 19/10/2026 | verified |'])),
    ['docs/local/research/sources.md: S-01 must have an ISO access date; got `19/10/2026`'],
  );
  assert.deepEqual(
    checkSources(withDocs(['| S-01 | https://example.org/a | x | 2026-10-19 | certain |'])),
    [
      'docs/local/research/sources.md: S-01 has class `certain`; it must be verified or vendor-claim',
    ],
  );
  assert.deepEqual(checkSources(withDocs([good, good])), [
    'docs/local/research/sources.md: S-01 is defined more than once',
  ]);
  assert.deepEqual(checkSources(withDocs([], '')), [
    'docs/local/research/sources.md: the register has no rows, so the checks are vacuous',
  ]);

  assert.deepEqual(checkSources(withDocs([good], 'Cites S-01.')), []);
  assert.deepEqual(checkSources(withDocs([good], 'Cites S-07.')), [
    'docs/local/research/competitive-landscape.md: cites S-07, which is not in the source register',
  ]);

  const claim = '| S-02 | https://example.org/b | x | 2026-10-19 | vendor-claim |';
  assert.deepEqual(
    checkSources(
      withDocs([good, claim], '| Product | Cell |\n| --- | --- |\n| A | does it (S-02) |'),
    ),
    [
      'docs/local/research/competitive-landscape.md: a table cell cites vendor-claim source S-02 without saying `claimed`',
    ],
  );
  assert.deepEqual(
    checkSources(
      withDocs([good, claim], '| Product | Cell |\n| --- | --- |\n| A | claimed: does it (S-02) |'),
    ),
    [],
  );
  assert.deepEqual(
    checkSources(
      withDocs(
        [good, claim],
        '| Product | Claim | Source |\n| --- | --- | --- |\n| A | claimed: it does | S-02 |',
      ),
    ),
    [],
    'a column holding only source ids is a citation, not an assertion',
  );
  assert.deepEqual(checkSources(corpus({})), [], 'absent until the register is written');
});

/** @param {string[]} rows @param {string} [entities] */
const PRD = (rows, entities = 'Alpha and Beta') =>
  [
    GOOD_HEADER,
    '## Entities in the first slice',
    '',
    `${entities}. Their fields are elsewhere.`,
    '',
    '## Requirements',
    '',
    '| ID | Requirement | Phase | MVP-0 | Persona | Acceptance criterion |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
const USERS = `${GOOD_HEADER}\n| P-1 | one |\n| P-3 | three |\n`;
const CONTRACTS = `${GOOD_HEADER}\nAlpha and Beta are here.\n`;

test('requirements need unique ids, a phase, a persona that exists, and a criterion', () => {
  /** @param {string[]} rows @param {string} [entities] */
  const run = (rows, entities) =>
    checkRequirements(
      corpus({
        'docs/local/prd.md': PRD(rows, entities),
        'docs/local/users-and-workflows.md': USERS,
        'docs/local/data-contracts.md': CONTRACTS,
      }),
    );
  const ok = '| R-001 | Do a thing | 1 | yes | P-3 | It is tested. |';
  assert.deepEqual(run([ok]), []);
  assert.deepEqual(run([ok, ok]), ['docs/local/prd.md: R-001 is defined more than once']);
  assert.deepEqual(run(['| R-002 | x | 7 | yes | P-3 | c |']), [
    'docs/local/prd.md: R-002 has phase `7`; it must be 0 to 5',
  ]);
  assert.deepEqual(run(['| R-002 | x | 1 | maybe | P-3 | c |']), [
    'docs/local/prd.md: R-002 has MVP-0 `maybe`; it must be yes or no',
  ]);
  assert.deepEqual(run(['| R-002 | x | 1 | yes | P-9 | c |']), [
    'docs/local/prd.md: R-002 names persona P-9, which users-and-workflows.md does not define',
  ]);
  assert.deepEqual(run(['| R-002 | x | 1 | yes | P-3 |  |']), [
    'docs/local/prd.md: R-002 has no acceptance criterion',
  ]);
  assert.deepEqual(run([ok], 'Alpha, Beta and Gamma'), [
    'docs/local/prd.md: entity Gamma is not described in data-contracts.md',
  ]);
  assert.deepEqual(run([]), [
    'docs/local/prd.md: the requirements table has no rows, so the checks are vacuous',
  ]);
  assert.deepEqual(checkRequirements(corpus({})), [], 'absent until the PRD is written');
});

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
/** @param {string} heading @param {string[]} [fields] @param {string} [validation] */
const kpiSection = (heading, fields = KPI_FIELDS, validation = '`junit-basic`') =>
  [
    `### ${heading}`,
    '',
    ...fields.map((field) => `**${field}.** ${field === 'Validation' ? validation : 'text'}`),
  ].join('\n\n');

test('every KPI has its ten fields, real fixtures, and every existing metric is accounted for', () => {
  const fixtures = {
    manifest: [{ id: 'junit-basic', kind: 'handwritten', provenance: GOOD_PROVENANCE }],
    goldens: {},
    files: [],
  };
  /** @param {string} body @param {string} [ux] @param {string[]} [metrics] */
  const run = (body, ux = '', metrics = ['first-pass-rate']) =>
    checkKpis(
      corpus(
        {
          'docs/local/kpi-dictionary.md': `${GOOD_HEADER}\n${body}\n\n\`first-pass-rate\` is adopted.`,
          ...(ux === '' ? {} : { 'docs/local/ux-spec.md': `${GOOD_HEADER}\n${ux}` }),
        },
        { fixtures, kpiMetricIds: metrics },
      ),
    );
  assert.deepEqual(run(kpiSection('K-01 Tests found')), []);
  assert.deepEqual(
    run(
      kpiSection(
        'K-01 Tests found',
        KPI_FIELDS.filter((field) => field !== 'Freshness'),
      ),
    ),
    ['docs/local/kpi-dictionary.md: K-01 is missing the field `Freshness`'],
  );
  assert.deepEqual(run(kpiSection('K-01 Tests found', KPI_FIELDS, '`no-such-fixture`')), [
    'docs/local/kpi-dictionary.md: K-01 validates against `no-such-fixture`, which is not a corpus fixture',
  ]);
  assert.deepEqual(run(`${kpiSection('K-01 Tests found')}\n\n${kpiSection('K-01 Again')}`), [
    'docs/local/kpi-dictionary.md: K-01 is defined more than once',
  ]);
  assert.deepEqual(run('### K-14 Later\n\n**Status:** Planned\n\n**Preconditions.** History.'), []);
  assert.deepEqual(run('### K-14 Later\n\n**Status:** Planned'), [
    'docs/local/kpi-dictionary.md: K-14 is planned and states no `Preconditions`',
  ]);
  assert.deepEqual(run(kpiSection('K-01 Tests found'), '', ['first-pass-rate', 'flake-rate']), [
    'docs/local/kpi-dictionary.md: the reporting metric `flake-rate` is neither adopted nor marked not adopted',
  ]);
  assert.deepEqual(run(kpiSection('K-06 and K-07 Duration')), []);
  assert.deepEqual(run(kpiSection('K-01 Tests found'), 'Shows K-01 and K-07.'), [
    'docs/local/ux-spec.md: cites K-07, which the KPI dictionary does not define',
  ]);
  assert.deepEqual(run('', ''), [
    'docs/local/kpi-dictionary.md: no KPI sections found, so the checks are vacuous',
  ]);
});

test('every threat has a mitigation and an owner, and threat citations resolve', () => {
  /** @param {string[]} rows */
  const model = (rows) =>
    [
      GOOD_HEADER,
      '| ID | Threat | Mitigation | Enforceable | Residual |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
  /** @param {string[]} rows @param {string} [other] */
  const run = (rows, other = '') =>
    checkThreats(
      corpus({
        'docs/local/runner-and-threat-model.md': model(rows),
        ...(other === '' ? {} : { 'docs/local/architecture.md': `${GOOD_HEADER}\n${other}` }),
      }),
    );
  assert.deepEqual(run(['| T-01 | bad | Do this | Yes | Residual. Owner: maintainers. |']), []);
  assert.deepEqual(run(['| T-01 | bad |  | Yes | Residual. Owner: maintainers. |']), [
    'docs/local/runner-and-threat-model.md: T-01 states no mitigation or accepted risk',
  ]);
  assert.deepEqual(run(['| T-01 | bad | Do this | Yes | Residual. |']), [
    'docs/local/runner-and-threat-model.md: T-01 names no owner for its residual risk',
  ]);
  assert.deepEqual(run(['| T-01 | bad | Do this | Yes | Owner: me |'], 'See T-09.'), [
    'docs/local/architecture.md: cites T-09, which the threat model does not define',
  ]);
  assert.deepEqual(run([]), [
    'docs/local/runner-and-threat-model.md: the threat table has no rows, so the check is vacuous',
  ]);
});

test('every screen states all five states', () => {
  /** @param {string[]} states */
  const screen = (states) =>
    [GOOD_HEADER, '### Screen: One', '', ...states.map((state) => `**${state}.** text`)].join(
      '\n\n',
    );
  const all = ['Loading', 'Empty', 'Error', 'Partial', 'Success'];
  assert.deepEqual(checkUx(corpus({ 'docs/local/ux-spec.md': screen(all) })), []);
  assert.deepEqual(
    checkUx(
      corpus({ 'docs/local/ux-spec.md': screen(all.filter((state) => state !== 'Partial')) }),
    ),
    ['docs/local/ux-spec.md: screen One does not state `Partial`'],
  );
  assert.deepEqual(checkUx(corpus({ 'docs/local/ux-spec.md': GOOD_HEADER })), [
    'docs/local/ux-spec.md: no screens found, so the check is vacuous',
  ]);
});

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
/** @param {number} n @param {string} requirements @param {string[]} [fields] */
const phase = (n, requirements, fields = PHASE_FIELDS) =>
  [
    `## Phase ${String(n)}: name`,
    '',
    ...fields.map((field) => `**${field}.** ${field === 'Requirements' ? requirements : 'text'}`),
  ].join('\n\n');

test('the roadmap schedules every requirement in the phase the PRD names', () => {
  const prd = PRD(['| R-001 | a | 1 | yes | P-3 | c |', '| R-002 | b | 2 | no | P-3 | c |']);
  /** @param {string[]} phases */
  const run = (phases) =>
    checkRoadmap(
      corpus({
        'docs/local/prd.md': prd,
        'docs/local/roadmap.md': `${GOOD_HEADER}\n${phases.join('\n\n')}`,
      }),
    );
  /** @param {string} a @param {string} b */
  const all = (a, b) => [0, 1, 2, 3, 4, 5].map((n) => phase(n, n === 1 ? a : n === 2 ? b : 'none'));
  assert.deepEqual(run(all('R-001', 'R-002')), []);
  assert.deepEqual(run(all('R-001', 'none')), [
    'docs/local/roadmap.md: R-002 is not scheduled in any phase',
  ]);
  assert.deepEqual(run(all('R-001, R-002', 'none')), [
    'docs/local/roadmap.md: R-002 is scheduled in phase 1 but the PRD says phase 2',
  ]);
  assert.deepEqual(run(all('R-001, R-077', 'R-002')), [
    'docs/local/roadmap.md: phase 1 lists R-077, which the PRD does not define',
  ]);
  const missing = [
    phase(
      0,
      'none',
      PHASE_FIELDS.filter((field) => field !== 'Risks'),
    ),
  ];
  assert.deepEqual(run([...missing, ...all('R-001', 'R-002').slice(1)]), [
    'docs/local/roadmap.md: phase 0 is missing the field `Risks`',
  ]);
  assert.deepEqual(run(all('R-001', 'R-002').slice(1)), [
    'docs/local/roadmap.md: phase 0 is missing',
  ]);
});

test('every failure scenario states behaviour, recovery and verification', () => {
  /** @param {string[]} rows */
  const doc = (rows) =>
    [
      GOOD_HEADER,
      '| ID | Scenario | Severity | Likelihood | Expected | Recovery | Verification |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
  /** @param {string[]} rows */
  const run = (rows) =>
    checkRisks(corpus({ 'docs/local/risks-and-adversarial-review.md': doc(rows) }));
  assert.deepEqual(run(['| F-01 | s | High | Low | does x | do y | test z |']), []);
  assert.deepEqual(run(['| F-01 | s | Huge | Low | does x | do y | test z |']), [
    'docs/local/risks-and-adversarial-review.md: F-01 has severity `Huge`; it must be Low, Medium or High',
  ]);
  assert.deepEqual(run(['| F-01 | s | High | Low | does x | do y |  |']), [
    'docs/local/risks-and-adversarial-review.md: F-01 states no verification',
  ]);
  assert.deepEqual(run([]), [
    'docs/local/risks-and-adversarial-review.md: the scenario table has no rows, so the check is vacuous',
  ]);
});

test('every planned item states a precondition, and every decision cites a record', () => {
  /** @param {string} bullets */
  const planned = (bullets) =>
    corpus({ 'docs/local/toolbox-and-intelligence.md': `${GOOD_HEADER}\n${bullets}` });
  assert.deepEqual(
    checkPlanned(
      planned('- Planned: a thing.\n  Precondition: something.\n- Planned: b. Precondition: x.'),
    ),
    [],
  );
  assert.deepEqual(
    checkPlanned(planned('- Planned: a thing with no condition.\n- Planned: b. Precondition: x.')),
    [
      'docs/local/toolbox-and-intelligence.md: a planned item states no `Precondition`: "a thing with no condition."',
    ],
  );
  /** @param {string[]} rows */
  const arch = (rows) =>
    corpus({
      'docs/local/architecture.md': [
        GOOD_HEADER,
        '## Decisions',
        '',
        '| D | C | R |',
        '| --- | --- | --- |',
        ...rows,
        '',
        '## Next',
      ].join('\n'),
    });
  assert.deepEqual(checkArchitecture(arch(['| a | b | [ADR-007](x) |'])), []);
  assert.deepEqual(checkArchitecture(arch(['| a | b | nothing |'])), [
    'docs/local/architecture.md: the decision `a` cites no ADR',
  ]);
});

test('every registered check is run by blueprintFindings', () => {
  assert.ok(BLUEPRINT_CHECKS.length >= 14, 'all the blueprint checks are registered');
  const findings = blueprintFindings(corpus({}));
  assert.ok(findings.length > 0, 'an empty corpus must not produce a clean result');
});

test('the committed docs/local set has no findings', () => {
  const real = readBlueprintCorpus(REPO_ROOT);
  assert.deepEqual(blueprintFindings(real), []);
  assert.ok(real.docs.length >= 1, 'the corpus was read');
});
