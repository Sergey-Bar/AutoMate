import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ASSERTIONS,
  HISTORICAL_DOCS,
  SUPERSEDED_DOCS,
  collectDriftEnvironment,
  driftFindings,
  unimplemented,
} from './docs-drift.mjs';
import { indexFiles } from './status-ten.mjs';
import { readRootScripts } from './gate-tooling.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** @param {string} relative */
function read(relative) {
  return existsSync(relative) ? readFileSync(relative, 'utf8') : '';
}

let index = null;
/** @returns {string[]} */
function files() {
  index ??= indexFiles(REPO_ROOT);
  return index;
}

/**
 * The register's rows, for the capability-claim detector.
 *
 * @returns {Array<{ id: string, capability: string, status: string }>}
 */
function registerRows() {
  return read(path.join(REPO_ROOT, 'docs', 'migration', 'capability-register.md'))
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[a-z0-9][a-z0-9.-]*\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        id: cells[0] ?? '',
        capability: cells[1] ?? '',
        status: cells[2] ?? '',
      };
    });
}

const environment = collectDriftEnvironment(
  REPO_ROOT,
  (relative) => read(path.join(REPO_ROOT, relative)),
  files,
  readRootScripts(),
  registerRows(),
);

test('the collector reaches the documents, or every detector below passes on nothing', () => {
  // The narrowest version of the failure this file exists to prevent. A first
  // version chained `.filter(front door).filter(docs/**)` — an intersection of two
  // disjoint sets — so `documents` was empty and all seven detectors reported a
  // clean repository with a straight face.
  assert.ok(
    environment.documents.length >= 10,
    `only ${String(environment.documents.length)} document(s) in scope; the detectors are vacuous`,
  );
  for (const expected of [
    'README.md',
    'docs/architecture/db-migration.md',
    'docs/adr/README.md',
    'site/index.md',
  ]) {
    assert.ok(
      environment.documents.some((document) => document.path === expected),
      `${expected} is not in scope, so the checks are not reading what a reader reads`,
    );
  }
  // And the derived truth is non-empty, because every detector below compares
  // against it: a port list of nothing would make every port in prose correct.
  assert.ok(
    environment.realPorts.size >= 2,
    `derived ports: ${[...environment.realPorts].join(',')}`,
  );
  assert.ok(
    environment.knownEnvVars.size >= 20,
    `derived env vars: ${environment.knownEnvVars.size}`,
  );
});

test('every declared assertion has a detector', () => {
  assert.equal(
    ASSERTIONS.length,
    8,
    'roadmap E4 names seven, and the eighth is `coverage-floors`, added on 2026-10-02 and ' +
      "recorded in this file's header because `AGENTS.md` quoted a floor table that was wrong " +
      'in every row. A ninth is another decision to record, not a number to bump.',
  );
  assert.deepEqual(
    unimplemented(),
    [],
    `assertions with no detector: ${unimplemented().join(', ')}. A null entry is reported by name ` +
      'rather than counted as implemented.',
  );
});

/**
 * Runs one detector over a fixture document.
 *
 * @param {string} id an entry of `ASSERTIONS`
 * @param {string} docPath
 * @param {string} text
 * @param {Array<{ id: string, capability: string, status: string }>} [rows]
 * @returns {string[]}
 */
function findingsFor(id, docPath, text, rows) {
  const assertion = ASSERTIONS.find((candidate) => candidate.id === id);
  assert.ok(assertion?.check, `${id} has no detector to test`);
  return assertion.check({
    ...environment,
    documents: [{ path: docPath, text }],
    registerRows: rows ?? environment.registerRows,
    fileExists: (relative) => files().includes(relative),
  });
}

test('each detector fires on the shape of claim it exists to catch', () => {
  // One assertion per detector, each written against the defect the roadmap named
  // rather than against the implementation, so a detector that stops matching is a
  // failing test and not a silent clean.
  assert.deepEqual(
    findingsFor('links', 'README.md', 'See [the plan](./docs/does-not-exist.md) for detail.'),
    ['README.md: link to `./docs/does-not-exist.md`, which does not exist'],
  );
  assert.deepEqual(
    findingsFor('links', 'README.md', 'See [getting started](./site/guide/getting-started.md).'),
    [],
    'a link that resolves is not a finding, or the detector reports every link in the repository',
  );

  assert.deepEqual(
    findingsFor(
      'commands',
      'README.md',
      'Run `pnpm verify:local` then `pnpm a-script-nobody-added`.',
    ),
    ['README.md: `pnpm a-script-nobody-added` is not a script in the root package.json'],
  );
  assert.deepEqual(
    findingsFor(
      'commands',
      'README.md',
      'Run `pnpm --filter @automate/api test` and `pnpm install`.',
    ),
    [],
    'a filtered package script and a built-in are not root scripts and are not findings',
  );

  assert.deepEqual(
    findingsFor(
      'ports',
      'docs/x.md',
      'The dashboard client is on `:4000` and the reporter on `:4001`.',
    ),
    [
      'docs/x.md: `4000` is not a port this repository binds. The real ones are ' +
        `${[...environment.realPorts].sort().join(', ')}.`,
      'docs/x.md: `4001` is not a port this repository binds. The real ones are ' +
        `${[...environment.realPorts].sort().join(', ')}.`,
    ],
  );
  assert.deepEqual(
    findingsFor(
      'ports',
      'docs/x.md',
      'The API listens on `127.0.0.1:3000` and the web on `localhost:5173`.',
    ),
    [],
  );

  assert.deepEqual(
    findingsFor(
      'env-vars',
      'docs/x.md',
      'Rotate `AUTOMATE_DASHBOARD_API_KEY` and `VAULT_PASSWORD`.',
    ),
    [
      'docs/x.md: `AUTOMATE_DASHBOARD_API_KEY` is not declared in packages/config and read nowhere in the workspace',
      'docs/x.md: `VAULT_PASSWORD` is not declared in packages/config and read nowhere in the workspace',
    ],
  );
  assert.deepEqual(
    findingsFor(
      'env-vars',
      'docs/x.md',
      'Set `VAULT_SECRET` and `REPORTER_SECRET` in both terminals.',
    ),
    [],
  );

  assert.deepEqual(
    findingsFor(
      'transports',
      'docs/x.md',
      'The `REPORTER_SECRET` secures the WebSocket connection.',
    ),
    [
      'docs/x.md: describes a websocket transport this product does not have. The realtime transport is ' +
        'SSE over a durable outbox feed; the reporter ingest is HTTP POST.',
    ],
  );
  assert.deepEqual(
    findingsFor(
      'transports',
      'docs/x.md',
      'Post-MVP: add a WebSocket transport, and the reporter package is not a WebSocket.',
    ),
    [],
    'a document is entitled to record a transport the product does not have; only claiming one is a defect',
  );

  assert.deepEqual(
    findingsFor(
      'capability-claims',
      'docs/x.md',
      'The mobile quality domain is supported end to end.',
      [{ id: 'quality.mobile', capability: 'Mobile quality domain', status: 'deferred' }],
    ),
    [
      'docs/x.md: asserts something is `real` about `quality.mobile`, which the register marks ' +
        '`deferred`. A document may name it and must say it is `deferred`.',
    ],
  );
  assert.deepEqual(
    findingsFor(
      'capability-claims',
      'docs/x.md',
      'The mobile quality domain is deferred to a later release.',
      [{ id: 'quality.mobile', capability: 'Mobile quality domain', status: 'deferred' }],
    ),
    [],
    'the honest sentence is the required one, and a gate that flagged it would be switched off',
  );
  assert.deepEqual(
    findingsFor(
      'capability-claims',
      'docs/x.md',
      'The k6 metric and threshold adapter is implemented.',
      [{ id: 'tool.k6', capability: 'k6 metric and threshold adapter', status: 'missing' }],
    ),
    [
      'docs/x.md: asserts something is `real` about `tool.k6`, which the register marks `missing`. ' +
        'A document may name it and must say it is `missing`.',
    ],
  );

  assert.deepEqual(
    findingsFor('adrs', 'docs/x.md', 'See ADR-042 for the decision.', []).map((line) =>
      line.startsWith('docs/x.md: references ADR-042'),
    ),
    [true],
  );
  assert.deepEqual(findingsFor('adrs', 'docs/x.md', 'See ADR-042 for the decision.', []).length, 1);

  // The eighth assertion. Written against the defect rather than the implementation:
  // the real `AGENTS.md` table was wrong in all eight rows, so the detector's whole
  // value is the arm that fires.
  const floor = environment.coverageFloors.get('apps/api');
  assert.ok(floor !== undefined, 'apps/api must have a recorded floor, or this arm proves nothing');
  assert.deepEqual(findingsFor('coverage-floors', 'AGENTS.md', `| \`apps/api\` | 93/84/93/96 |`), [
    `AGENTS.md: quotes \`apps/api\`'s coverage floor as 93/84/93/96, and ` +
      `\`coverage-baseline.json\` records ${floor}. A floor printed in prose is a copy, ` +
      'and the ratchet moves the original every time a package gains tests.',
  ]);
  assert.deepEqual(
    findingsFor('coverage-floors', 'AGENTS.md', `| \`apps/api\` | ${floor} |`),
    [],
    'the floor the baseline records is not a finding, or the detector fails the table it protects',
  );
  assert.deepEqual(
    findingsFor('coverage-floors', 'AGENTS.md', '| `packages/ui` | 59/74/62/59 |'),
    [
      "AGENTS.md: quotes `packages/ui`'s coverage floor as 59/74/62/59, and `coverage-baseline.json` records 67/84/68/66. A floor printed in prose is a copy, and the ratchet moves the original every time a package gains tests.",
    ],
    'the real `AGENTS.md` tuple, so the arm fails if the detector stops matching the shape it exists for',
  );
  assert.deepEqual(
    findingsFor('coverage-floors', 'docs/x.md', 'The gate runs 3 times, 4 times and 12 times.'),
    [],
    'a table that is not a floor table is not a floor table',
  );
});

test('a quoted or struck-through claim is a recorded claim, not a fresh one', () => {
  // The same rule the unused-claim gate in `docs-paths.test.mjs` applies, and for the
  // same reason: a document has to be able to write down what is wrong without the
  // gate reporting the quotation as the claim.
  assert.deepEqual(
    findingsFor(
      'transports',
      'docs/x.md',
      'The runbook claimed "the WebSocket carries the events".',
    ),
    [],
  );
  assert.deepEqual(
    findingsFor('transports', 'docs/x.md', 'The WebSocket carries the events. ~~It does not.~~'),
    [
      'docs/x.md: describes a websocket transport this product does not have. The realtime transport is ' +
        'SSE over a durable outbox feed; the reporter ingest is HTTP POST.',
    ],
  );
});

test('an exempt document says so in its own text, or it is a gap rather than a decision', () => {
  // The difference between an exemption and a hole. A document a reader might open
  // and believe must tell them, above the fold, that it describes a tree this
  // repository is not. A silently exempted document is the failure this file exists
  // to prevent, re-introduced one level up.
  for (const exempt of [...HISTORICAL_DOCS, ...SUPERSEDED_DOCS]) {
    const source = read(path.join(REPO_ROOT, exempt));
    assert.notEqual(
      source,
      '',
      `${exempt} is exempt but does not exist, so the exemption is stale`,
    );
    assert.match(
      source.slice(0, 900),
      /superseded|historical|retitled|superseded proposal|Status.*Draft/i,
      `${exempt} is exempt from the drift gate but does not announce it. A reader who opens it must ` +
        'be told before reading a line that it is not a description of this tree.',
    );
  }
  // And the exemption is not a hole: the ADR register exists, so the decisions the
  // exempted documents record have somewhere to live.
  assert.ok(
    environment.documents.some((document) => document.path === 'docs/adr/README.md'),
    'the ADR register is itself in scope, so a decision an exempted document recorded is still readable',
  );
});

test('the committed documentation does not drift from the code', () => {
  const findings = driftFindings(environment);
  assert.deepEqual(
    findings,
    [],
    `documents claim something the code does not do:\n${findings.join('\n')}\n` +
      'Each line is a defect in the prose, not in the checker: the expected values are read out of ' +
      '`packages/config`, `playwright.config.ts`, the compose file and the root package.json.',
  );
});
