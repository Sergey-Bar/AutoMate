import React from 'react';
import {
  Badge,
  Button,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import type {
  DiffCoverageStatus,
  HealthFinding,
  HealthFindingsPage,
  PortfolioComponentsPage,
  ProjectHealth,
  SbomComponentsPage,
  SupplyChainPolicy,
  SupplyChainPolicyRecord,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient } from '../lib/health-client.js';
import { ago } from '../lib/health-view.js';
import type { QaClient } from '../lib/qa-client.js';
import { canAdminister, failureText } from '../lib/roles.js';
import type { SupplyChainClient } from '../lib/supply-chain-client.js';
import { listField } from './Delivery.js';
import { PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import {
  Loaded,
  PageControls,
  ProjectPage,
  projectLink,
  type ProjectContext,
} from './ProjectPage.js';
import { StatusLine } from './StatusLine.js';
import { useToast } from './Toasts.js';

/**
 * Supply chain: what the repository ships, under which licences, built by whom, and what a
 * commit's tests touched.
 *
 * Every figure is read from the server — the SBOM inventory, the licence findings
 * `automate-licence` raised against the policy, the findings a VEX statement accepted, the
 * Supply chain dimension of the grade (where SLSA provenance lands), and diff coverage.
 * Nothing is computed here but counts of what arrived.
 */
export const LICENCE_TOOL = 'automate-licence';
export const VEX_PREFIX = 'vex:';
const PAGE = 25;

/** The CycloneDX component types, the vocabulary the inventory's `type` filter matches. */
export const COMPONENT_TYPES = [
  'application',
  'framework',
  'library',
  'container',
  'platform',
  'operating-system',
  'device',
  'firmware',
  'file',
  'machine-learning-model',
  'data',
] as const;

export function SupplyChainPage({
  qa,
  health,
  supplyChain,
  projectId,
}: {
  qa: QaClient;
  health: HealthClient;
  supplyChain: SupplyChainClient;
  projectId?: string | undefined;
}): React.ReactElement {
  return (
    <ProjectPage qa={qa} health={health} title="Supply chain" projectId={projectId}>
      {(context) => <SupplyChainBody context={context} health={health} client={supplyChain} />}
    </ProjectPage>
  );
}

function SupplyChainBody({
  context,
  health,
  client,
}: {
  context: ProjectContext;
  health: HealthClient;
  client: SupplyChainClient;
}): React.ReactElement {
  const { project, switcher, who } = context;
  const licences = useResource<HealthFindingsPage>(
    () => health.getFindings(project.id, { tool: LICENCE_TOOL, state: 'open', limit: 100 }),
    [health, project.id],
  );
  return (
    <PageFrame data-testid="supply-chain-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Supply chain"
        subtitle={`What ${project.name} ships, and under which terms`}
        actions={switcher}
      />
      <Loaded resource={licences} label="the licence findings" testId="licences">
        {(page) => <LicenceStatus page={page} />}
      </Loaded>
      <div className="grid gap-3 lg:grid-cols-2">
        <ProvenancePanel health={health} projectId={project.id} />
        <LicenceFindings resource={licences} />
        <VexAccepted health={health} projectId={project.id} />
        <DiffCoverageLookup client={client} projectId={project.id} />
      </div>
      <Inventory client={client} projectId={project.id} />
      <PolicyPanel client={client} projectId={project.id} admin={canAdminister(who)} />
      <PortfolioSearch client={client} />
    </PageFrame>
  );
}

function LicenceStatus({ page }: { page: HealthFindingsPage }): React.ReactElement {
  return (
    <StatusLine
      data-testid="supply-chain-status"
      value={String(page.total)}
      tone={page.total === 0 ? 'good' : 'bad'}
      sentence={
        page.total === 1
          ? 'component breaks the licence policy.'
          : 'components break the licence policy.'
      }
    />
  );
}

function FindingList({
  findings,
  testId,
}: {
  findings: readonly HealthFinding[];
  testId: string;
}): React.ReactElement {
  return (
    <ul className="divide-y divide-border text-sm" data-testid={testId}>
      {findings.map((finding) => (
        <li key={finding.id} className="py-2">
          <p className="max-w-measure">{finding.message}</p>
          <p className="text-xs text-fg-muted">
            <span className="font-mono">{finding.ruleId}</span>
            {finding.triageReason === null ? '' : ` · ${finding.triageReason}`}
            {finding.triageExpiresAt === null
              ? ''
              : ` · until ${finding.triageExpiresAt.slice(0, 10)}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function LicenceFindings({
  resource,
}: {
  resource: ReturnType<typeof useResource<HealthFindingsPage>>;
}): React.ReactElement {
  return (
    <Panel title="Licence findings" data-testid="licence-findings">
      <Loaded resource={resource} label="the licence findings">
        {(page) =>
          page.findings.length === 0 ? (
            <Quiet>
              No component breaks the licence policy. With no policy saved, licences are not
              evaluated at all.
            </Quiet>
          ) : (
            <FindingList findings={page.findings} testId="licence-list" />
          )
        }
      </Loaded>
    </Panel>
  );
}

/** Findings a VEX statement accepted: `triagedBy` is `vex:<document id>`. */
export function vexAccepted(findings: readonly HealthFinding[]): HealthFinding[] {
  return findings.filter((finding) => finding.triagedBy?.startsWith(VEX_PREFIX) === true);
}

function VexAccepted({
  health,
  projectId,
}: {
  health: HealthClient;
  projectId: string;
}): React.ReactElement {
  const accepted = useResource<HealthFindingsPage>(
    () => health.getFindings(projectId, { state: 'accepted', limit: 100 }),
    [health, projectId],
  );
  return (
    <Panel title="Accepted by VEX" data-testid="vex-findings">
      <Loaded resource={accepted} label="the accepted findings">
        {(page) => {
          const vex = vexAccepted(page.findings);
          return vex.length === 0 ? (
            <Quiet>No finding has been accepted by a VEX statement.</Quiet>
          ) : (
            <FindingList findings={vex} testId="vex-list" />
          );
        }}
      </Loaded>
    </Panel>
  );
}

function ProvenancePanel({
  health,
  projectId,
}: {
  health: HealthClient;
  projectId: string;
}): React.ReactElement {
  const grade = useResource<ProjectHealth>(() => health.getHealth(projectId), [health, projectId]);
  return (
    <Panel title="SLSA provenance" data-testid="slsa-summary">
      <Loaded resource={grade} label="the provenance">
        {(value) => <ProvenanceSummary health={value} />}
      </Loaded>
    </Panel>
  );
}

function ProvenanceSummary({ health }: { health: ProjectHealth }): React.ReactElement {
  const dimension = health.grade.dimensions.find((entry) => entry.dimension === 'supply-chain');
  const upload = health.reports.find((report) => report.format === 'slsa-provenance');
  if (dimension === undefined || !dimension.measured) {
    return (
      <Quiet data-testid="slsa-unmeasured">
        Not measured: no SLSA provenance or supply-chain report has been uploaded for{' '}
        {health.branch}.
      </Quiet>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">{dimension.letter ?? '—'}</span>
        <span className="tabular-nums text-fg-muted">
          {dimension.score === null ? 'no score' : `${dimension.score.toFixed(0)} / 100`}
        </span>
      </p>
      <ul className="space-y-1 text-xs text-fg-muted">
        {dimension.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-xs text-fg-muted" data-testid="slsa-upload">
        {upload === undefined
          ? 'No provenance attestation on this branch.'
          : `Latest attestation ${ago(upload.receivedAt)}${upload.commitSha === null ? '' : ` at ${upload.commitSha.slice(0, 7)}`}.`}
      </p>
    </div>
  );
}

const DIFF_STATE_TEXT = {
  'waiting-for-coverage': 'The diff arrived; waiting for line coverage of this commit.',
  'waiting-for-diff': 'Line coverage arrived; waiting for the diff of this commit.',
  none: 'Nothing has been uploaded for this commit.',
} as const;

export const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/iu;

function DiffCoverageLookup({
  client,
  projectId,
}: {
  client: SupplyChainClient;
  projectId: string;
}): React.ReactElement {
  const id = React.useId();
  const [commit, setCommit] = React.useState('');
  const [result, setResult] = React.useState<DiffCoverageStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const lookUp = (event: React.FormEvent) => {
    event.preventDefault();
    if (!COMMIT_PATTERN.test(commit.trim())) {
      setError('A commit is 7 to 64 hexadecimal characters.');
      return;
    }
    setError(null);
    client
      .getDiffCoverage(projectId, commit)
      .then(setResult)
      .catch((failure: unknown) => setError(failureText(failure, 'Diff coverage was not read')));
  };
  return (
    <Panel title="Diff coverage" data-testid="diff-coverage">
      <form onSubmit={lookUp} aria-label="Diff coverage lookup" className="flex items-end gap-2">
        <Input
          id={`${id}-commit`}
          label="Commit"
          value={commit}
          placeholder="abcdef1"
          onChange={(event) => setCommit(event.target.value)}
        />
        <Button type="submit" variant="secondary" className="min-h-11">
          Look up
        </Button>
      </form>
      {error === null ? null : (
        <p role="alert" className="mt-2 max-w-measure text-sm text-danger">
          {error}
        </p>
      )}
      {result === null ? null : <DiffCoverageResult status={result} />}
    </Panel>
  );
}

function DiffCoverageResult({ status }: { status: DiffCoverageStatus }): React.ReactElement {
  const { result } = status;
  if (status.state !== 'computed' || result === null) {
    return (
      <Quiet data-testid="diff-coverage-state">
        {DIFF_STATE_TEXT[status.state === 'computed' ? 'none' : status.state]}
      </Quiet>
    );
  }
  return (
    <div className="mt-3 space-y-2 text-sm" data-testid="diff-coverage-result">
      <p className="tabular-nums">
        <span className="text-2xl font-semibold">
          {result.ratio === null ? 'no executable line' : `${(result.ratio * 100).toFixed(1)}%`}
        </span>{' '}
        <span className="text-fg-muted">{`${String(result.covered)} of ${String(result.executable)} changed lines covered`}</span>
      </p>
      {result.uncovered.length === 0 ? null : (
        <ul className="space-y-0.5 font-mono text-xs" aria-label="Uncovered changed lines">
          {result.uncovered.map((file) => (
            <li key={file.path}>{`${file.path}: ${file.lines.join(', ')}`}</li>
          ))}
        </ul>
      )}
      {result.unmeasuredFiles.length === 0 ? null : (
        <p className="text-xs text-fg-muted">
          {`No coverage for ${result.unmeasuredFiles.join(', ')}.`}
        </p>
      )}
    </div>
  );
}

function Inventory({
  client,
  projectId,
}: {
  client: SupplyChainClient;
  projectId: string;
}): React.ReactElement {
  const id = React.useId();
  const [type, setType] = React.useState('');
  const [licenceDraft, setLicenceDraft] = React.useState('');
  const [licence, setLicence] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const page = useResource<SbomComponentsPage>(
    () =>
      client.getComponents(projectId, {
        type: type === '' ? undefined : type,
        licence: licence === '' ? undefined : licence,
        offset,
        limit: PAGE,
      }),
    [client, projectId, type, licence, offset],
  );
  return (
    <Panel title="Inventory" data-testid="inventory">
      <form
        aria-label="Inventory filters"
        className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setLicence(licenceDraft.trim());
          setOffset(0);
        }}
      >
        <Select
          id={`${id}-type`}
          label="Type"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setOffset(0);
          }}
          options={[
            { value: '', label: 'Every type' },
            ...COMPONENT_TYPES.map((entry) => ({ value: entry, label: entry })),
          ]}
        />
        <Input
          id={`${id}-licence`}
          label="Licence"
          value={licenceDraft}
          placeholder="MIT"
          onChange={(event) => setLicenceDraft(event.target.value)}
        />
        <Button type="submit" variant="secondary" className="min-h-11">
          Filter
        </Button>
      </form>
      <Loaded resource={page} label="the inventory" testId="inventory">
        {(value) => <ComponentTable page={value} onOffset={setOffset} />}
      </Loaded>
    </Panel>
  );
}

function ComponentTable({
  page,
  onOffset,
}: {
  page: SbomComponentsPage;
  onOffset: (offset: number) => void;
}): React.ReactElement {
  if (page.total === 0) {
    return (
      <Quiet data-testid="inventory-empty">
        {`No component on ${page.branch} matches. An SBOM upload (CycloneDX or SPDX) fills this in.`}
      </Quiet>
    );
  }
  return (
    <>
      <Table aria-label={`Components on ${page.branch}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Licence</TableHead>
            <TableHead className="hidden lg:table-cell">Supplier</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.components.map((component) => (
            <TableRow
              key={`${component.purl ?? component.name}-${component.version ?? ''}`}
              data-testid="component-row"
            >
              <TableCell>
                <span className="text-sm">{component.name}</span>
                {component.version === null ? null : (
                  <span className="ml-1 font-mono text-xs text-fg-muted">{component.version}</span>
                )}
                <span className="block break-all font-mono text-xs text-fg-muted">
                  {component.purl ?? 'no purl'}
                </span>
              </TableCell>
              <TableCell className="text-xs">{component.type}</TableCell>
              <TableCell className="text-xs">{licenceText(component)}</TableCell>
              <TableCell className="hidden text-xs lg:table-cell">
                {component.supplier ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PageControls
        offset={page.offset}
        shown={page.components.length}
        total={page.total}
        size={page.limit}
        onOffset={onOffset}
        testId="inventory-range"
      />
    </>
  );
}

/** A component's licence, as the SBOM said it — and "unknown" when it said nothing. */
export function licenceText(component: SbomComponentsPage['components'][number]): string {
  if (component.licenceExpression !== null) return component.licenceExpression;
  return component.licences.length === 0 ? 'unknown' : component.licences.join(', ');
}

function PolicyPanel({
  client,
  projectId,
  admin,
}: {
  client: SupplyChainClient;
  projectId: string;
  admin: boolean;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const record = useResource<SupplyChainPolicyRecord>(
    () => client.getPolicy(projectId),
    [client, projectId, version],
  );
  return (
    <Panel title="Supply-chain policy" data-testid="policy">
      <Loaded resource={record} label="the policy" testId="policy">
        {(value) => (
          <>
            <PolicySummary record={value} />
            {admin ? (
              <PolicyForm
                client={client}
                projectId={projectId}
                record={value}
                onSaved={() => setVersion((current) => current + 1)}
              />
            ) : null}
          </>
        )}
      </Loaded>
    </Panel>
  );
}

function listText(list: readonly string[] | undefined, none: string): string {
  if (list === undefined) return none;
  return list.length === 0 ? 'empty' : list.join(', ');
}

function PolicySummary({ record }: { record: SupplyChainPolicyRecord }): React.ReactElement {
  const { policy } = record;
  if (policy === null) {
    return (
      <Quiet data-testid="policy-none">
        No policy is saved: licences are not evaluated, and provenance is checked against an empty
        trust set, so no signature can be verified.
      </Quiet>
    );
  }
  return (
    <dl
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"
      data-testid="policy-summary"
    >
      <dt className="text-fg-muted">Allowed licences</dt>
      <dd>{listText(policy.licences.allow, 'any not denied')}</dd>
      <dt className="text-fg-muted">Denied licences</dt>
      <dd>{listText(policy.licences.deny, 'none')}</dd>
      <dt className="text-fg-muted">Unknown licence</dt>
      <dd>{policy.licences.failOnUnknown ? 'a violation' : 'allowed'}</dd>
      <dt className="text-fg-muted">Trusted builders</dt>
      <dd className="break-all">
        {listText(policy.provenance.allowedBuilders, 'none: level 3 cannot be claimed')}
      </dd>
      <dt className="text-fg-muted">Trust</dt>
      <dd>{`${String(policy.provenance.trustedKeysPem.length)} keys, ${String(policy.provenance.trustedRootsPem.length)} roots`}</dd>
      <dt className="text-fg-muted">Saved</dt>
      <dd>
        {record.updatedAt === null ? 'never' : ago(record.updatedAt)}
        {record.updatedBy === null ? '' : ` by ${record.updatedBy}`}
      </dd>
    </dl>
  );
}

/** The policy an admin's form describes. Keys and roots are kept: the form does not edit PEM. */
export function policyFromForm(
  base: SupplyChainPolicy | null,
  form: { allow: string; deny: string; failOnUnknown: boolean; builders: string },
): SupplyChainPolicy {
  const allow = listField(form.allow);
  const builders = listField(form.builders);
  // Unset, not empty: an empty allow list allows nothing, and no builder list means level 3
  // cannot be claimed. The form's empty field means "no list".
  const { allowedBuilders: _previous, ...provenance } = base?.provenance ?? {
    trustedKeysPem: [],
    trustedRootsPem: [],
  };
  return {
    licences: {
      ...(allow.length === 0 ? {} : { allow }),
      deny: listField(form.deny),
      failOnUnknown: form.failOnUnknown,
    },
    provenance: builders.length === 0 ? provenance : { ...provenance, allowedBuilders: builders },
  };
}

function PolicyForm({
  client,
  projectId,
  record,
  onSaved,
}: {
  client: SupplyChainClient;
  projectId: string;
  record: SupplyChainPolicyRecord;
  onSaved: () => void;
}): React.ReactElement {
  const toast = useToast();
  const ids = React.useId();
  const policy = record.policy;
  const [allow, setAllow] = React.useState((policy?.licences.allow ?? []).join(', '));
  const [deny, setDeny] = React.useState((policy?.licences.deny ?? []).join(', '));
  const [failOnUnknown, setFailOnUnknown] = React.useState(policy?.licences.failOnUnknown ?? true);
  const [builders, setBuilders] = React.useState(
    (policy?.provenance.allowedBuilders ?? []).join(', '),
  );
  const [error, setError] = React.useState<string | null>(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    client
      .setPolicy(projectId, policyFromForm(policy, { allow, deny, failOnUnknown, builders }))
      .then(() => {
        toast({ tone: 'success', title: 'Policy saved' });
        onSaved();
      })
      .catch((failure: unknown) => setError(failureText(failure, 'The policy was not saved')));
  };
  return (
    <form
      onSubmit={submit}
      aria-label="Edit the policy"
      className="mt-4 space-y-3 border-t border-border pt-4"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          id={`${ids}-allow`}
          label="Allowed licences"
          value={allow}
          placeholder="Empty: any licence not denied"
          onChange={(event) => setAllow(event.target.value)}
        />
        <Input
          id={`${ids}-deny`}
          label="Denied licences"
          value={deny}
          onChange={(event) => setDeny(event.target.value)}
        />
        <Input
          id={`${ids}-builders`}
          label="Trusted builders"
          value={builders}
          onChange={(event) => setBuilders(event.target.value)}
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={failOnUnknown}
            onChange={(event) => setFailOnUnknown(event.target.checked)}
            className="h-5 w-5 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
          An unknown licence is a violation
        </label>
      </div>
      {error === null ? null : (
        <p role="alert" className="max-w-measure text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" className="min-h-11">
        Save policy
      </Button>
    </form>
  );
}

function PortfolioSearch({ client }: { client: SupplyChainClient }): React.ReactElement {
  const id = React.useId();
  const [prefix, setPrefix] = React.useState('');
  const [result, setResult] = React.useState<PortfolioComponentsPage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const search = (event: React.FormEvent) => {
    event.preventDefault();
    if (!prefix.trim().startsWith('pkg:')) {
      setError('A purl starts with pkg:, as in pkg:npm/lodash.');
      return;
    }
    setError(null);
    client
      .searchPortfolio(prefix)
      .then(setResult)
      .catch((failure: unknown) => setError(failureText(failure, 'The search failed')));
  };
  return (
    <Panel title="Where is it used" data-testid="portfolio-search">
      <form
        onSubmit={search}
        aria-label="Portfolio component search"
        className="flex items-end gap-2"
      >
        <Input
          id={`${id}-purl`}
          label="Package URL prefix"
          value={prefix}
          placeholder="pkg:npm/lodash"
          onChange={(event) => setPrefix(event.target.value)}
        />
        <Button type="submit" variant="secondary" className="min-h-11">
          Search
        </Button>
      </form>
      {error === null ? null : (
        <p role="alert" className="mt-2 max-w-measure text-sm text-danger">
          {error}
        </p>
      )}
      {result === null ? null : <PortfolioMatches page={result} />}
    </Panel>
  );
}

function PortfolioMatches({ page }: { page: PortfolioComponentsPage }): React.ReactElement {
  if (page.total === 0) {
    return <Quiet data-testid="portfolio-search-empty">No repository ships a match.</Quiet>;
  }
  return (
    <ul className="mt-3 divide-y divide-border text-sm" data-testid="portfolio-matches">
      {page.matches.map((match) => (
        <li
          key={`${match.projectId}-${match.branch}-${match.purl}`}
          className="flex flex-wrap items-baseline gap-x-3 py-2"
        >
          <a
            href={projectLink('/dashboard/supply-chain', match.projectId)}
            className="font-medium underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {match.project}
          </a>
          <Badge variant="outline">{match.branch}</Badge>
          <span className="break-all font-mono text-xs text-fg-muted">{match.purl}</span>
        </li>
      ))}
      {page.total > page.matches.length ? (
        <li className="py-2 text-xs text-fg-muted">
          {`${String(page.total - page.matches.length)} more not shown.`}
        </li>
      ) : null}
    </ul>
  );
}
