import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  HealthFindingsPage,
  ProjectHealth,
  SbomComponentsPage,
} from '@automate/shared-contracts';
import type { FindingQuery, HealthClient } from '../lib/health-client.js';
import type { SupplyChainClient } from '../lib/supply-chain-client.js';
import {
  makeComponentsPage,
  makeDiffCoverage,
  makeDimension,
  makeFinding,
  makeFindingsPage,
  makeHealthDouble,
  makePolicyRecord,
  makeProjectHealth,
  makeQa,
  pending,
  serverRefusal,
  TEST_PROJECT,
} from '../test-utils.js';
import { ToastProvider } from './Toasts.js';
import { SupplyChainPage, licenceText, policyFromForm, vexAccepted } from './SupplyChain.js';

const LICENCE = makeFinding();
const VEX = makeFinding({
  id: 'finding-2',
  tool: 'osv-scanner',
  ruleId: 'CVE-2026-1',
  kind: 'vulnerability',
  message: 'lodash has a prototype pollution',
  state: 'accepted',
  triageReason: 'VEX: vulnerable_code_not_in_execute_path',
  triageExpiresAt: '2027-01-01T00:00:00.000Z',
  triagedBy: 'vex:https://vex.example.test/1',
});
const OPERATOR_ACCEPTED = makeFinding({
  id: 'finding-3',
  state: 'accepted',
  triagedBy: 'user:admin',
  message: 'accepted by a person',
});

function findingsFor(query: FindingQuery | undefined): HealthFindingsPage {
  if (query?.tool === 'automate-licence') return makeFindingsPage([LICENCE]);
  return makeFindingsPage([VEX, OPERATOR_ACCEPTED]);
}

function healthDouble(
  role: 'viewer' | 'operator' | 'admin' = 'admin',
  overrides: Partial<HealthClient> = {},
): HealthClient {
  return makeHealthDouble(role, {
    getFindings: vi.fn(async (_id: string, query?: FindingQuery) => findingsFor(query)),
    getHealth: vi.fn(async () => makeProjectHealth()),
    ...overrides,
  });
}

function clientDouble(overrides: Partial<SupplyChainClient> = {}): SupplyChainClient {
  return {
    getComponents: vi.fn(async () => makeComponentsPage()),
    searchPortfolio: vi.fn(async () => ({
      matches: [
        {
          projectId: 'project-2',
          project: 'Billing',
          slug: 'billing',
          branch: 'main',
          purl: 'pkg:npm/lodash@4.17.21',
          name: 'lodash',
          version: '4.17.21',
        },
      ],
      total: 3,
      offset: 0,
      limit: 100,
    })),
    getPolicy: vi.fn(async () => makePolicyRecord()),
    setPolicy: vi.fn(async () => makePolicyRecord()),
    getDiffCoverage: vi.fn(async () => makeDiffCoverage()),
    getScorecard: vi.fn(async () => {
      throw new Error('not stubbed');
    }),
    ...overrides,
  };
}

function renderPage(
  client: SupplyChainClient = clientDouble(),
  health: HealthClient = healthDouble(),
) {
  return render(
    <ToastProvider>
      <SupplyChainPage qa={makeQa()} health={health} supplyChain={client} />
    </ToastProvider>,
  );
}

describe('the supply-chain page', () => {
  it('leads with the licence violations and lists each', async () => {
    const health = healthDouble();
    renderPage(clientDouble(), health);
    expect(await screen.findByTestId('supply-chain-status')).toHaveTextContent(
      '1component breaks the licence policy.',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Supply chain' })).toBeInTheDocument();
    expect(await screen.findByTestId('licence-list')).toHaveTextContent('GPL-3.0-only');
    expect(health.getFindings).toHaveBeenCalledWith(TEST_PROJECT.id, {
      tool: 'automate-licence',
      state: 'open',
      limit: 100,
    });
  });

  it('lists only the findings a VEX statement accepted, with the reason and expiry', async () => {
    renderPage();
    const vex = await screen.findByTestId('vex-list');
    expect(vex).toHaveTextContent('lodash has a prototype pollution');
    expect(vex).toHaveTextContent('vulnerable_code_not_in_execute_path');
    expect(vex).toHaveTextContent('until 2027-01-01');
    expect(vex).not.toHaveTextContent('accepted by a person');
  });

  it('summarises SLSA provenance from the grade and the latest attestation', async () => {
    renderPage();
    const slsa = await screen.findByTestId('slsa-summary');
    await waitFor(() => expect(slsa).toHaveTextContent('SLSA build level 2'));
    expect(slsa).toHaveTextContent('B');
    expect(slsa).toHaveTextContent('80 / 100');
    expect(within(slsa).getByTestId('slsa-upload')).toHaveTextContent('at abcdef1');
  });

  it('says provenance is not measured, and when there is no attestation', async () => {
    const unmeasured = makeProjectHealth({ reports: [] });
    const grade = {
      ...unmeasured.grade,
      dimensions: unmeasured.grade.dimensions.map((entry) =>
        entry.dimension === 'supply-chain' ? makeDimension({ dimension: 'supply-chain' }) : entry,
      ),
    };
    const { unmount } = renderPage(
      clientDouble(),
      healthDouble('admin', {
        getHealth: vi.fn(async (): Promise<ProjectHealth> => ({ ...unmeasured, grade })),
      }),
    );
    expect(await screen.findByTestId('slsa-unmeasured')).toHaveTextContent('Not measured');
    unmount();
    renderPage(clientDouble(), healthDouble('admin', { getHealth: vi.fn(async () => unmeasured) }));
    expect(await screen.findByTestId('slsa-upload')).toHaveTextContent('No provenance attestation');
  });

  it('pages the inventory and filters it by type and licence', async () => {
    const client = clientDouble({
      getComponents: vi.fn(async () => makeComponentsPage({ total: 60 })),
    });
    renderPage(client);
    const inventory = await screen.findByTestId('inventory');
    expect(await within(inventory).findAllByTestId('component-row')).toHaveLength(2);
    expect(inventory).toHaveTextContent('pkg:npm/react@19.0.0');
    expect(inventory).toHaveTextContent('no purl');
    expect(within(inventory).getByTestId('inventory-range')).toHaveTextContent('1–2 of 60');
    fireEvent.click(within(inventory).getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(client.getComponents).toHaveBeenLastCalledWith(TEST_PROJECT.id, {
        type: undefined,
        licence: undefined,
        offset: 25,
        limit: 25,
      }),
    );
    fireEvent.change(within(inventory).getByLabelText('Type'), { target: { value: 'library' } });
    fireEvent.change(within(inventory).getByLabelText('Licence'), { target: { value: ' MIT ' } });
    fireEvent.click(within(inventory).getByRole('button', { name: 'Filter' }));
    await waitFor(() =>
      expect(client.getComponents).toHaveBeenLastCalledWith(TEST_PROJECT.id, {
        type: 'library',
        licence: 'MIT',
        offset: 0,
        limit: 25,
      }),
    );
  });

  it('says what fills an empty inventory, and shows the server’s refusal', async () => {
    const { unmount } = renderPage(
      clientDouble({
        getComponents: vi.fn(async (): Promise<SbomComponentsPage> =>
          makeComponentsPage({ components: [], total: 0 }),
        ),
      }),
    );
    expect(await screen.findByTestId('inventory-empty')).toHaveTextContent('An SBOM upload');
    unmount();
    renderPage(
      clientDouble({
        getComponents: vi.fn(async () => {
          throw serverRefusal('No SBOM on main', 404);
        }),
      }),
    );
    expect(await screen.findByTestId('inventory-error')).toHaveTextContent('No SBOM on main');
  });

  it('looks up diff coverage by commit, and refuses a commit that is not one', async () => {
    const client = clientDouble();
    renderPage(client);
    const panel = await screen.findByTestId('diff-coverage');
    fireEvent.change(within(panel).getByLabelText('Commit'), { target: { value: 'main' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('7 to 64 hexadecimal');
    expect(client.getDiffCoverage).not.toHaveBeenCalled();
    fireEvent.change(within(panel).getByLabelText('Commit'), { target: { value: 'abcdef1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    const result = await within(panel).findByTestId('diff-coverage-result');
    expect(result).toHaveTextContent('80.0%');
    expect(result).toHaveTextContent('8 of 10 changed lines covered');
    expect(result).toHaveTextContent('src/a.ts: 4, 9');
    expect(result).toHaveTextContent('No coverage for src/b.md');
    expect(client.getDiffCoverage).toHaveBeenCalledWith(TEST_PROJECT.id, 'abcdef1');
  });

  it.each([
    [{ state: 'waiting-for-coverage' as const, result: null }, 'waiting for line coverage'],
    [{ state: 'waiting-for-diff' as const, result: null }, 'waiting for the diff'],
    [{ state: 'none' as const, result: null }, 'Nothing has been uploaded'],
  ])('says what diff coverage is waiting for: %o', async (status, text) => {
    renderPage(clientDouble({ getDiffCoverage: vi.fn(async () => makeDiffCoverage(status)) }));
    const panel = await screen.findByTestId('diff-coverage');
    fireEvent.change(within(panel).getByLabelText('Commit'), { target: { value: 'abcdef1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    expect(await within(panel).findByTestId('diff-coverage-state')).toHaveTextContent(text);
  });

  it('reads a commit with no executable change line, and a lookup the server refused', async () => {
    const client = clientDouble({
      getDiffCoverage: vi
        .fn()
        .mockResolvedValueOnce(
          makeDiffCoverage({
            result: {
              covered: 0,
              executable: 0,
              ratio: null,
              uncovered: [],
              unmeasuredFiles: [],
              computedAt: '2026-10-23T12:00:00.000Z',
            },
          }),
        )
        .mockRejectedValueOnce(serverRefusal('No project p-9', 404)),
    });
    renderPage(client);
    const panel = await screen.findByTestId('diff-coverage');
    fireEvent.change(within(panel).getByLabelText('Commit'), { target: { value: 'abcdef1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    expect(await within(panel).findByTestId('diff-coverage-result')).toHaveTextContent(
      'no executable line',
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('No project p-9');
  });

  it('shows the policy to everyone and the editor only to an admin', async () => {
    const { unmount } = renderPage(clientDouble(), healthDouble('operator'));
    const summary = await screen.findByTestId('policy-summary');
    expect(summary).toHaveTextContent('MIT, Apache-2.0');
    expect(summary).toHaveTextContent('GPL-3.0-only');
    expect(summary).toHaveTextContent('a violation');
    expect(summary).toHaveTextContent('1 keys, 0 roots');
    expect(summary).toHaveTextContent('by admin');
    expect(screen.queryByRole('form', { name: 'Edit the policy' })).not.toBeInTheDocument();
    unmount();
    renderPage(clientDouble(), healthDouble('admin'));
    expect(await screen.findByRole('form', { name: 'Edit the policy' })).toBeInTheDocument();
  });

  it('says what having no policy means', async () => {
    renderPage(
      clientDouble({
        getPolicy: vi.fn(async () =>
          makePolicyRecord({ policy: null, updatedAt: null, updatedBy: null }),
        ),
      }),
      healthDouble('viewer'),
    );
    expect(await screen.findByTestId('policy-none')).toHaveTextContent(
      'licences are not evaluated',
    );
  });

  it('saves an admin’s policy, keeping the trust it does not edit, and says why one failed', async () => {
    const client = clientDouble({
      setPolicy: vi
        .fn()
        .mockResolvedValueOnce(makePolicyRecord())
        .mockRejectedValueOnce(serverRefusal('Only an admin can change it', 403)),
    });
    renderPage(client);
    const form = await screen.findByRole('form', { name: 'Edit the policy' });
    fireEvent.change(within(form).getByLabelText('Allowed licences'), { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Denied licences'), {
      target: { value: 'GPL-3.0-only, AGPL-3.0-only' },
    });
    fireEvent.click(within(form).getByLabelText('An unknown licence is a violation'));
    fireEvent.click(within(form).getByRole('button', { name: 'Save policy' }));
    await waitFor(() =>
      expect(client.setPolicy).toHaveBeenCalledWith(TEST_PROJECT.id, {
        licences: { deny: ['GPL-3.0-only', 'AGPL-3.0-only'], failOnUnknown: false },
        provenance: {
          allowedBuilders: ['https://github.com/actions/runner'],
          trustedKeysPem: ['-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'],
          trustedRootsPem: [],
        },
      }),
    );
    expect(await screen.findByText('Policy saved')).toBeInTheDocument();
    await waitFor(() => expect(client.getPolicy).toHaveBeenCalledTimes(2));
    const again = await screen.findByRole('form', { name: 'Edit the policy' });
    fireEvent.click(within(again).getByRole('button', { name: 'Save policy' }));
    expect(await within(again).findByRole('alert')).toHaveTextContent(
      'Only an admin can change it',
    );
  });

  it('finds every repository shipping a purl prefix, and refuses one that is not a purl', async () => {
    const client = clientDouble();
    renderPage(client);
    const panel = await screen.findByTestId('portfolio-search');
    fireEvent.change(within(panel).getByLabelText('Package URL prefix'), {
      target: { value: 'lodash' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Search' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('starts with pkg:');
    fireEvent.change(within(panel).getByLabelText('Package URL prefix'), {
      target: { value: 'pkg:npm/lodash' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Search' }));
    const matches = await within(panel).findByTestId('portfolio-matches');
    expect(within(matches).getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      '/dashboard/supply-chain?project=project-2',
    );
    expect(matches).toHaveTextContent('2 more not shown.');
    expect(client.searchPortfolio).toHaveBeenCalledWith('pkg:npm/lodash');
  });

  it('says when nothing ships a match, and when the search failed', async () => {
    const client = clientDouble({
      searchPortfolio: vi
        .fn()
        .mockResolvedValueOnce({ matches: [], total: 0, offset: 0, limit: 100 })
        .mockRejectedValueOnce(new Error('')),
    });
    renderPage(client);
    const panel = await screen.findByTestId('portfolio-search');
    fireEvent.change(within(panel).getByLabelText('Package URL prefix'), {
      target: { value: 'pkg:npm/nothing' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Search' }));
    expect(await within(panel).findByTestId('portfolio-search-empty')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Search' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('The search failed');
  });

  it('says when nothing breaks the licence policy, when no VEX applies, and what a read is waiting on', async () => {
    const health = healthDouble('viewer', {
      getFindings: vi.fn(async () => makeFindingsPage([])),
    });
    const { unmount } = renderPage(clientDouble(), health);
    expect(await screen.findByTestId('supply-chain-status')).toHaveTextContent('0components break');
    expect(screen.getByTestId('licence-findings')).toHaveTextContent('No component breaks');
    expect(await screen.findByTestId('vex-findings')).toHaveTextContent(
      'No finding has been accepted',
    );
    unmount();
    renderPage(
      clientDouble(),
      healthDouble('viewer', { getFindings: vi.fn(() => pending<HealthFindingsPage>()) }),
    );
    expect(await screen.findByTestId('licences-loading')).toBeInTheDocument();
  });

  it('shows the server’s message when the licence findings fail', async () => {
    renderPage(
      clientDouble(),
      healthDouble('viewer', {
        getFindings: vi.fn(async () => {
          throw serverRefusal('Findings store offline');
        }),
      }),
    );
    expect(await screen.findByTestId('licences-error')).toHaveTextContent('Findings store offline');
  });
});

describe('the supply-chain helpers', () => {
  it('reads a licence as the SBOM said it, and unknown when it said nothing', () => {
    const [react, vendored] = makeComponentsPage().components;
    expect(licenceText(react!)).toBe('MIT');
    expect(licenceText(vendored!)).toBe('unknown');
    expect(licenceText({ ...react!, licenceExpression: 'MIT OR Apache-2.0' })).toBe(
      'MIT OR Apache-2.0',
    );
  });

  it('keeps only VEX decisions', () => {
    expect(vexAccepted([VEX, OPERATOR_ACCEPTED, LICENCE]).map((finding) => finding.id)).toEqual([
      'finding-2',
    ]);
  });

  it('builds a policy, leaving an empty list unset and the trust it was given', () => {
    expect(
      policyFromForm(null, { allow: '', deny: '', failOnUnknown: true, builders: '' }),
    ).toEqual({
      licences: { deny: [], failOnUnknown: true },
      provenance: { trustedKeysPem: [], trustedRootsPem: [] },
    });
    expect(
      policyFromForm(makePolicyRecord().policy, {
        allow: 'MIT',
        deny: '',
        failOnUnknown: false,
        builders: '',
      }).provenance,
    ).not.toHaveProperty('allowedBuilders');
  });

  it('keeps the signer identities the form does not edit, as it keeps the PEMs', () => {
    const trustedIdentities = [
      {
        subject: 'https://github.com/octo/app/.github/workflows/release.yml@refs/heads/main',
        issuer: 'https://token.actions.githubusercontent.com',
      },
    ];
    const saved = policyFromForm(
      {
        licences: { failOnUnknown: true },
        provenance: { trustedKeysPem: [], trustedRootsPem: ['root'], trustedIdentities },
      },
      { allow: '', deny: '', failOnUnknown: true, builders: 'https://builder.example' },
    );
    expect(saved.provenance).toEqual({
      trustedKeysPem: [],
      trustedRootsPem: ['root'],
      trustedIdentities,
      allowedBuilders: ['https://builder.example'],
    });
  });
});
