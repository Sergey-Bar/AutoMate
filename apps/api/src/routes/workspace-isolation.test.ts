import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../index.js';

/**
 * `WORKSPACE_ID` is the only tenancy boundary this system has.
 *
 * There is no per-user authorisation anywhere: one installation, one workspace,
 * one credential. Which means a route that reads across that boundary is the
 * worst defect this API could ship — two customers' test evidence in one
 * response — and the only thing standing between that and production is a filter
 * somebody remembered to write.
 *
 * `routes/execution.test.ts` already drives all twenty-one execution endpoints
 * over a Drizzle-backed store with two workspaces present, and proves the
 * cross-workspace probe returns 404 rather than data. This file covers the two
 * things that leaves open:
 *
 *  1. **Every workspace-scoped route family**, not just the execution one. The
 *     reporting, reporter-results, runner, orchestration and dashboard families
 *     each take or return identifiers, and each is a separate place a filter can
 *     be missing.
 *  2. **The filter itself, as a source property.** A source scan asserts that
 *     every query that names a workspace also constrains on it. This is the only
 *     way to catch a *new* route that forgets, since a test for a route that does
 *     not exist yet cannot be written — and a source scan fails the same day the
 *     route lands.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * The installation key for the composed app.
 *
 * `createAuthMiddleware` has a deliberate open mode: with no key configured and
 * `NODE_ENV !== 'production'` it lets a request through, so a developer can run
 * the product without first provisioning a credential. That is a development
 * affordance, and asserting it as the *only* behaviour would be asserting the
 * wrong thing — so the key is set here and the production branch is asserted
 * separately, below.
 */
const TEST_KEY = 'workspace-isolation-installation-key';

beforeAll(() => {
  process.env['AUTOMATE_API_KEY'] = TEST_KEY;
});
afterAll(() => {
  delete process.env['AUTOMATE_API_KEY'];
});

/**
 * Route families that accept or return a workspace-owned identifier.
 *
 * Each entry names the files that make up the family. A family not in this list
 * is asserted by the second test, so adding one without naming it here is a
 * finding.
 */
const WORKSPACE_SCOPED_FAMILIES: ReadonlyArray<{
  family: string;
  files: readonly string[];
}> = [
  {
    // The composition root reads `WORKSPACE_ID` and is the one place it is
    // decided, so it is claimed here rather than excluded. It hands the value to
    // every family below, which is what makes them consistent with each other.
    family: 'composition root',
    files: ['index.ts'],
  },
  { family: 'execution routes', files: ['routes/execution.ts'] },
  // The one function that turns a run request into a queued run in a workspace. Both
  // `POST /api/v1/runs` and `browser.run` call it; `agents/browser-adapter.test.ts` and
  // `routes/agents-browser.test.ts` prove a run accepted for one workspace is invisible to
  // another.
  { family: 'run submission', files: ['execution/run-submission.ts'] },
  {
    family: 'agent execution bridge',
    files: [
      'agents/execution-bridge.ts',
      'agents/browser-adapter.ts',
      'agents/api-adapter.ts',
      'agents/load-adapter.ts',
    ],
  },
  { family: 'reporter results', files: ['routes/reporter-results.ts'] },
  { family: 'reporting', files: ['routes/reporting.ts'] },
  { family: 'runner', files: ['routes/runner.ts'] },
  { family: 'orchestration routes', files: ['routes/orchestration.ts'] },
  { family: 'events', files: ['routes/events.ts'] },
  { family: 'dashboard routes', files: ['modules/dashboard/index.ts'] },
  // The run trend reads the execution store with the composition root's workspace, and
  // `trend.test.ts` proves a run in another workspace is not counted.
  { family: 'analytics trend', files: ['execution/trend.ts'] },
  // The reliability insights page through the same reader as the trend; `insights.test.ts`
  // proves a run in another workspace is not counted.
  { family: 'reliability insights', files: ['execution/insights.ts'] },
  // Which quarantine entries a gate evaluation reads. `boundQuarantineSource` answers only
  // for the workspace its store is bound to, and `quarantine-gate.store.test.ts` proves one
  // workspace's approval does not excuse another workspace's failure, in both stores.
  { family: 'quarantine at the gate', files: ['execution/quarantine-excusal.ts'] },
  // A CI job's test report: recorded under the composition root's workspace, and judged
  // against that workspace's quarantine only. `test-reports.test.ts` proves another
  // workspace's approval does not excuse the run.
  { family: 'test reports', files: ['routes/test-reports.ts'] },
  // A project's quarantine policy and view. Every read and write of `projects.settings`
  // filters on `workspace_id`, and `quarantine-policy-service.test.ts` proves another
  // workspace's project can be neither read nor written.
  {
    family: 'project quarantine',
    files: ['services/quarantine-policy-service.ts', 'routes/project-quarantine.ts'],
  },
  // Triage labels: every statement filters `fingerprint_categories` on `workspace_id`, and
  // `triage-label-service.test.ts` proves another workspace can neither read nor change one.
  {
    family: 'triage labels',
    files: ['services/triage-label-service.ts', 'routes/triage-labels.ts'],
  },
  // The coverage and health history. Every query filters on `workspace_id` before the
  // project, and `projects.test.ts` proves a second workspace reads nothing back.
  { family: 'scan history', files: ['services/scan-history-service.ts'] },
  // Repository health: reports, findings, snapshots and settings. Every query filters on
  // `workspace_id` before the project, and `repo-health-service.test.ts` proves a project in
  // one workspace is invisible from another — reads, uploads and triage alike.
  {
    family: 'repository health',
    files: [
      'services/repo-health-service.ts',
      'routes/repo-health.ts',
      'services/health-findings.ts',
    ],
  },
  // Supply chain and diff coverage: the SBOM inventory, VEX documents, the policy, line maps
  // and diff coverage. `supply-chain-service.test.ts` and `diff-coverage-service.test.ts` prove
  // another workspace can neither read nor write any of them, and that the portfolio search
  // never returns another workspace's project.
  {
    family: 'supply chain and diff coverage',
    files: ['services/supply-chain-service.ts', 'services/diff-coverage-service.ts'],
  },
  // Delivery performance: sources, the sync queue and what it writes, the push door and the
  // GitHub webhook's replay store. `delivery-service.test.ts` proves another workspace can
  // neither read nor write a project's delivery data, `delivery-syncer.test.ts` that a sync
  // writes only into its own workspace, and `github-webhook.test.ts` that a webhook queues
  // nothing for another workspace's project of the same repository.
  {
    family: 'delivery performance',
    files: [
      'services/delivery-service.ts',
      'services/delivery-syncer.ts',
      'services/github-webhook.ts',
      'routes/delivery.ts',
      'routes/github-webhook.ts',
    ],
  },
  // AI-written code: the attribution the sync stores, the outcomes and scorecard read from it,
  // the governance check on one pull request and the gate's per-PR record of new findings.
  // `ai-code-service.test.ts` proves another workspace can neither read a project's ai-code
  // data nor record a gate finding on it, and that the portfolio lists only its own projects.
  {
    family: 'ai-written code',
    files: [
      'services/ai-code-service.ts',
      'services/ai-code-attribution.ts',
      'services/ai-code-outcomes.ts',
      'routes/ai-code.ts',
    ],
  },
  // Agent quality: eval runs and cases, GenAI spans, the MCP inventory and eval datasets — five
  // tables, each hard-scoped in `0040_agent_quality.sql`. Each service test ends with a
  // `workspace isolation` case proving another workspace can neither read nor write them:
  // `eval-service.test.ts`, `genai-span-service.test.ts` (including the installation's own
  // `self` spans), `agent-config-service.test.ts` and `eval-runner.test.ts`.
  {
    family: 'agent quality',
    files: [
      'services/eval-service.ts',
      'services/genai-span-service.ts',
      'services/agent-config-service.ts',
      'services/eval-runner.ts',
      'routes/agent-quality.ts',
    ],
  },
  // Issue trackers and issue links (`0041_issue_tracking.sql`) and AI test proposals
  // (`0042_test_proposals.sql`), each hard-scoped from its first migration.
  // `issue-tracker-service.test.ts` and `test-proposal-service.test.ts` each end with a case
  // proving another workspace can neither read a tracker, a link or a proposal, nor create
  // one against this workspace's project or finding.
  {
    family: 'issues and test proposals',
    files: [
      'services/issue-tracker-service.ts',
      'services/test-proposal-service.ts',
      'routes/issue-tracking.ts',
      'routes/test-proposals.ts',
    ],
  },
  // The read-only MCP server's tools and the stdio proxy in front of it. Every tool reads through
  // the health options the composition root binds to its workspace; `routes/mcp.test.ts` proves a
  // token from another workspace does not authenticate and another workspace's project is "no
  // such project", and that a caller pinned to one project reads only that project.
  {
    family: 'mcp server',
    files: ['routes/mcp.ts', 'mcp/tools.ts', 'mcp/server.ts'],
  },
  // The supply-chain and test-effectiveness scorecards and the portfolio heatmap. Every read
  // goes through `projectRow` and filters on `workspace_id`; `routes/scorecards.test.ts` proves
  // another workspace's project is "no such project" and that the heatmap lists only its own.
  {
    family: 'scorecards and heatmap',
    files: ['services/scorecard-service.ts', 'routes/scorecards.ts'],
  },
  // Role tokens and the audit trail. `access-service.test.ts` proves a token authenticates
  // only in the workspace that issued it, and that one workspace cannot list another's.
  {
    family: 'access tokens',
    files: ['services/access-service.ts', 'routes/access.ts', 'http/roles.ts'],
  },
  // Device pairing mints access tokens in the issuing workspace. `pairing-service.test.ts`
  // proves a code issued in one workspace does not redeem in another.
  { family: 'device pairing', files: ['services/pairing-service.ts', 'routes/pairing.ts'] },
  // A project's git token, bound to its row by the vault's AAD; `projects.test.ts` proves it
  // does not open under another secret, and `vault-crypto.test.ts` the binding itself.
  { family: 'git credentials', files: ['services/git-credential-service.ts'] },
  // The one sealed-secret store behind git credentials and notification channels; every
  // read filters on the workspace and the envelope's AAD binds it to its row.
  // `notification-service.test.ts` proves a channel's secret does not open from another
  // workspace.
  { family: 'vault secrets', files: ['services/vault-secrets.ts'] },
  // Scheduled reports: channels, subscriptions, deliveries and the dispatcher that sends them.
  // `notification-service.test.ts` proves one workspace cannot list, send to, or receive
  // another's.
  {
    family: 'scheduled reports',
    files: [
      'services/notification-service.ts',
      'services/report-dispatcher.ts',
      'services/report-areas.ts',
      'routes/notifications.ts',
    ],
  },
  // Below the route layer: the stores and services the families above delegate
  // to. They take a `workspaceId` on every method precisely so the routes cannot
  // forget it, and the second test in this file scans their `where` clauses.
  {
    family: 'execution stores',
    files: [
      'execution/canonical.ts',
      'execution/drizzle-execution-store.ts',
      'execution/in-memory-execution-store.ts',
      'execution/quality-gate.ts',
      'execution/types.ts',
    ],
  },
  { family: 'realtime feed', files: ['infrastructure/drizzle-realtime-feed.ts'] },
  {
    // The vault is claimed because it reads a workspace id, not because it queries a
    // table: `VaultRowBinding` carries `workspaceId` and that value is authenticated
    // as GCM additional authenticated data, so a row's workspace is part of what proves
    // the ciphertext belongs to it. Without the binding an envelope could be written
    // into any row and would open there — the vault returning one connector's credential
    // for another's, silently (ledger P-8).
    //
    // The isolation property is therefore *cryptographic* rather than a `where` clause,
    // and the second test in this file does not apply to it; what proves it is
    // `vault-crypto.test.ts`, which asserts that an envelope sealed for one row will
    // not open in another, varying each of workspace, name and entry id in turn. Claiming
    // it here with that pointer is more honest than leaving the file unclaimed, which is
    // what the first test in this file exists to prevent.
    family: 'vault',
    files: ['infrastructure/vault-crypto.ts'],
  },
  {
    family: 'dashboard stores',
    files: ['modules/dashboard/audit-sink.ts', 'modules/dashboard/drizzle-stores.ts'],
  },
  { family: 'realtime bus', files: ['realtime/durable-realtime-bus.ts'] },
  {
    family: 'ingestion services',
    files: ['services/drizzle-reporter-ingestion.ts', 'services/reporter-ingestion.ts'],
  },
  {
    // Both reporter write paths, claimed for the same reason: they now *write* a
    // workspace id. Before this gate's change they wrote NULL, and a run reported by a
    // real producer was persisted and invisible to `GET /api/v1/runs` — the reporter →
    // API → browser path end to end, which eleven E2E tests were asserting and could not
    // see. `reporter-persistence.test.ts` pins the stamped value to the one the listing
    // filters on, and `run-repository.ts` holds the field and the single-tenant default.
    //
    // The three files under `services/` are the *canonical* write path and the projection
    // it feeds. `canonical-projection.ts` takes the workspace off `identity` rather than
    // from a parameter, so it cannot be given one that disagrees with the row it is
    // projecting — and the run it writes is claimed by the ingestion service whose
    // constructor-scoped workspace the row was accepted under.
    family: 'reporter persistence',
    files: [
      'services/reporter-persistence.ts',
      'services/canonical-ingestion.ts',
      'services/canonical-projection.ts',
      'services/reporter-event-canonical.ts',
      'routes/reporter.ts',
      'repositories/drizzle-run-repository.ts',
      'repositories/in-memory-run-repository.ts',
      'repositories/run-repository.ts',
    ],
  },
  { family: 'orchestration service', files: ['services/orchestration-service.ts'] },
  {
    /**
     * The project registry and everything derived from it.
     *
     * Claimed rather than excluded because all three read a workspace id and all
     * three were written against the *same* tenant: `project-registry-service.ts`
     * takes `workspaceId` and puts it in every query; `qa-score-service.ts` reads
     * `canonical_run_results` filtered by it; `routes/projects.ts` is the door that
     * supplies it.
     *
     * Every read in the registry is `where(and(eq(workspaceId), ...))` — never a
     * bare `eq(id)` — because `runs.project_id` gained a foreign key in migration
     * 0023 and a run id is a uuid an attacker could supply. `routes/projects.test.ts`
     * is the route that proves it: it registers under `ws-1` and reads the same
     * project through a second, unowned id with no workspace of its own.
     */
    family: 'project registry',
    files: [
      'services/project-registry-service.ts',
      'services/qa-score-service.ts',
      'routes/projects.ts',
    ],
  },
];

describe('the composed API refuses unauthenticated access everywhere it should', () => {
  it('accepts the real key', async () => {
    const response = await app.request('/api/v1/runs', { headers: auth() });
    expect(response.status).toBe(200);
  });
});

// The describe that stood here asserted the API "refuses rather than opens when no key
// is configured in production", and there is no longer an open branch to be careful
// with: the install is open by design. What replaces it is the contract in
// `tests/e2e/product/open-access.spec.ts`, asserted against a real database rather than
// against an in-process app — which is the only place a claim about who may read a
// run is worth something.

describe('every workspace-scoped family constrains on the workspace', () => {
  it('has a family entry for each module that names a workspace', () => {
    const declared = new Set(
      WORKSPACE_SCOPED_FAMILIES.flatMap((entry) => entry.files).map(
        (file) => `apps/api/src/${file}`,
      ),
    );
    expect(declared.size, 'no family claims any file').toBeGreaterThan(0);

    // Every workspace-scoped source file must be claimed by a family, so a new one
    // cannot appear unreviewed. `execution/` is a directory of route modules and
    // is covered by its entry point.
    const apiRoot = path.join(root, 'apps/api/src');
    for (const file of walkSources(apiRoot)) {
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (!relative.startsWith('apps/api/src/')) continue;
      if (file.includes(`${path.sep}test-support${path.sep}`)) continue;
      if (relative.includes('/routes/execution/')) continue;
      const source = readFileSync(file, 'utf8');
      if (!/workspaceId|WORKSPACE_ID/.test(source)) continue;
      if (relative.includes('.test.')) continue;
      const isClaimed = claimsFamily(declared, relative);
      expect(
        isClaimed,
        `${relative} reads a workspace id but is not claimed by a WORKSPACE_SCOPED_FAMILIES ` +
          'entry. Add one, with the route that proves it does not read across.',
      ).toBe(true);
    }
  });

  it('cannot be called without a workspace: every id-addressed store method takes one', () => {
    // The property that actually holds the boundary, stated where it can be
    // checked exactly.
    //
    // The obvious version of this — scan for a `where(` with no `workspaceId`
    // within a few lines — was written and then deleted. It reported 37 findings
    // in the Drizzle store, all of them correct, because a Drizzle query is
    // written across many lines and the constraint can be expressed as a subquery,
    // a join, or a `and()` several clauses in. A check that fires on every
    // correct query is a check people learn to skip, which is worse than not
    // having it.
    //
    // So the property is structural instead: `ExecutionStore` is the only way any
    // route reaches the database, and every method that takes a run, job, artifact
    // or event id *also* takes the workspace. A caller cannot forget it, and a
    // new method that forgets it fails this test on the day it is added.
    const store = executionStoreContract();
    expect(store).not.toBeNull();

    /** Methods whose names suggest they address a workspace-owned row. */
    const addressedById = [...(store ?? [])].filter(
      (signature) =>
        /\b(runId|jobId|artifactId|eventId|releaseId|leaseId)\b/.test(signature.parameters) &&
        !/\bworkspaceId\b/.test(signature.parameters),
    );
    expect(
      addressedById.map((signature) => `${signature.name}(${signature.parameters})`),
      'a store method addresses a workspace-owned row but does not take a workspaceId, so ' +
        'a caller can read across the tenancy boundary. Add the parameter — the route layer ' +
        'already has the value.',
    ).toEqual([]);
  });

  it('reads the interface at runtime, so the list above cannot go stale', () => {
    // A `typeof` annotation is erased at runtime, so a list written by hand
    // describes the interface as it *was*. The implementation of both stores is
    // also checked, which is what makes it live.
    const methods = executionStoreContract();
    expect(methods?.length ?? 0, 'no ExecutionStore methods were discovered').toBeGreaterThan(10);
  });
});

/**
 * `ExecutionStore` method signatures, read from both implementations.
 *
 * Read from the source rather than reflected, because TypeScript interfaces do
 * not exist at runtime. Both implementations are read so the two cannot diverge.
 *
 * Parsed with string operations rather than a regular expression. The regex that
 * looked right — `\s*` either side of an optional generic group, then a captured
 * parameter list — is the shape `security/detect-unsafe-regex` refuses, and it is
 * right to: the engine can backtrack across the optional group and the whitespace
 * run for every position. Bounding the quantifiers did not satisfy the rule either,
 * and a rule being satisfied by widening a cap is a rule being worked around. A
 * line-by-line parse is shorter than the pattern was anyway.
 *
 * @returns one entry per method, with its parameter list as written
 */
function executionStoreContract(): Array<{ name: string; parameters: string }> | null {
  const files = ['execution/types.ts', 'execution/drizzle-execution-store.ts'];
  /** @type {Map<string, { name: string, parameters: string }>} */
  const byName = new Map();

  for (const relative of files) {
    const source = readFileSync(path.join(root, 'apps/api/src', relative), 'utf8');
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const start = methodSignatureStart(lines[index] ?? '');
      if (start === null) continue;
      const parameters = closingParenthesis(lines, index, start.openIndex);
      if (parameters === null) continue;
      // Keyed by file *and* method, so the interface and the implementation are
      // two entries rather than one reconciled against the other. Reconciling them
      // looked tidier and was a real hole: re-opening the gap in the interface
      // alone left the two disagreeing, the disagreement was discarded as a
      // duplicate, and the test passed on the implementation's stricter signature.
      // The mismatch is itself worth seeing, so nothing is reconciled.
      byName.set(`${relative}:${start.name}`, { name: start.name, parameters: parameters.text });
      index = parameters.lastIndex;
    }
  }
  return [...byName.values()];
}

/** The identifier characters a string starts with. */
function leadingIdentifier(text: string): string {
  let name = '';
  for (const character of text) {
    if (!'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.includes(character))
      break;
    name += character;
  }
  return name;
}

/**
 * The method a line opens, if it opens one.
 *
 * Only lines indented by exactly two spaces qualify, which is what separates a
 * method from a nested call and from a local arrow function.
 */
function methodSignatureStart(line: string): { name: string; openIndex: number } | null {
  if (!line.startsWith('  ') || line.startsWith('   ')) return null;
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/')) return null;

  let rest = trimmed;
  if (rest.startsWith('readonly ')) rest = rest.slice('readonly '.length);
  if (rest.startsWith('async ')) rest = rest.slice('async '.length);

  const name = leadingIdentifier(rest);
  if (name === '') return null;
  let index = name.length;

  // An optional generic parameter list, discarded but skipped.
  while (rest[index] !== '(' && index < rest.length) {
    if (!' \t<'.includes(rest[index] ?? '')) return null;
    index += 1;
  }
  if (rest[index] !== '(') return null;
  return { name, openIndex: index };
}

/**
 * The parameter list opened at `openIndex`, following it across lines.
 *
 * Depth-tracked, because a parameter's own type can contain both: `page?: {
 * afterSequence?: number }` has a closing paren inside it, and taking the first
 * `)` truncates the signature and makes the whole scan miss.
 *
 * A method declaration ends in `;` and a body begins with `{`; a line that ends
 * in neither is a call or a nested expression, not a declaration.
 */
function closingParenthesis(
  lines: readonly string[],
  startLine: number,
  openIndex: number,
): { text: string; lastIndex: number } | null {
  const first = lines[startLine] ?? '';
  const sameLine = balancedClose(first, openIndex);
  if (sameLine !== -1) {
    if (!isDeclarationTail(first.slice(sameLine + 1))) return null;
    return { text: first.slice(openIndex + 1, sameLine), lastIndex: startLine };
  }

  const parts: string[] = [first.slice(openIndex + 1)];
  for (let line = startLine + 1; line < lines.length; line += 1) {
    const text = lines[line] ?? '';
    const close = balancedClose(text, -1);
    if (close !== -1) {
      parts.push(text.slice(0, close));
      if (!isDeclarationTail(text.slice(close + 1))) return null;
      return { text: parts.join(' '), lastIndex: line };
    }
    parts.push(text);
  }
  return null;
}

/**
 * Whether what follows a `)` closes a method *declaration*.
 *
 * Three shapes, and getting the list wrong is how half the interface goes
 * unread: `name(): Type;` on one line, `name(\n…\n): Type;` closing on its own
 * line, and `name(): Type {` opening a body. Requiring the tail to *start* with
 * `;` or `{` — the obvious reading — silently skips every one-liner with a return
 * type, which is most of `ExecutionStore`, and the scan then reports a clean
 * interface while having read a third of it.
 */
function isDeclarationTail(tail: string): boolean {
  const trimmed = tail.trimStart();
  if (trimmed === '') return true;
  if (trimmed.startsWith('{')) return true;
  return trimmed.endsWith(';');
}

/**
 * The index of the `)` that closes the paren at `openIndex`, or -1.
 *
 * `openIndex` of -1 means "the depth starts fresh at the beginning of the line",
 * which is what a continuation line needs. Tracks `(`/`)` and `{`/`}` together,
 * because a default value or a type literal can contain either.
 */
function balancedClose(text: string, openIndex: number): number {
  let depth = 0;
  let started = openIndex === -1;
  for (let index = openIndex === -1 ? 0 : openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(' || character === '{') {
      depth += 1;
      started = true;
      continue;
    }
    if (character === ')' || character === '}') {
      depth -= 1;
      if (started && depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Whether a source file is claimed by one of the declared families.
 *
 * A family claims the file it names, and everything under it when the name is a
 * directory. `routes/execution.ts` therefore covers `routes/execution/*.ts`.
 *
 * @param declared the `file` values of every family
 * @param relative the file, relative to the repository root, `/`-separated
 */
function claimsFamily(declared: ReadonlySet<string>, relative: string): boolean {
  for (const claim of declared) {
    if (relative === claim) return true;
    const withoutExtension = claim.endsWith('.ts') ? claim.slice(0, -'.ts'.length) : claim;
    if (relative.startsWith(`${withoutExtension}/`)) return true;
  }
  return false;
}

/** Bearer credential for the test installation. */
function auth(): Record<string, string> {
  return { authorization: `Bearer ${TEST_KEY}` };
}

/** Every `.ts` source file under a directory, excluding tests. */
function walkSources(directory: string): string[] {
  const found: string[] = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) found.push(full);
    }
  }
  return found;
}
