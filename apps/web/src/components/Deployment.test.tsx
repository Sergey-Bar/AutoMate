import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeploymentPage, describeProfile } from './Deployment.js';
import { makeHealthDouble } from '../test-utils.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import type { WhoAmI } from '../lib/health-client.js';
import type { AdminClient } from '../lib/admin-client.js';

/** `canCreate` is the API's answer, from the rule its create route enforces. */
function makeAdminDouble(canCreate = false): AdminClient {
  return {
    listMembers: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    addMember: vi.fn(),
    listAudit: vi.fn(),
    verifyAudit: vi.fn(),
    exportUrl: () => '',
    listWorkspaces: vi.fn(async () => ({
      current: 'default',
      workspaces: [{ id: 'default', name: 'Default', role: 'admin' as const }],
      canCreate,
    })),
    selectWorkspace: vi.fn(async () => undefined),
    createWorkspace: vi.fn(async () => undefined),
  } as AdminClient;
}

function renderFor(who: WhoAmI) {
  const health = makeHealthDouble('admin', { whoami: vi.fn(async () => who) });
  return render(<DeploymentPage health={health} />);
}

describe('the deployment page', () => {
  it('names a solo install for what it is, and offers the next step', async () => {
    const { container } = renderFor({
      actor: 'anonymous',
      role: 'admin',
      mode: 'open',
      profile: 'solo',
    });
    const status = await screen.findByTestId('deployment-status');
    expect(status).toHaveTextContent('Solo');
    expect(status).toHaveTextContent('One person, on this machine');
    expect(within(status).getByRole('link', { name: 'Open your projects' })).toHaveAttribute(
      'href',
      '/dashboard/portfolio',
    );
    expect(screen.getByTestId('deployment-access')).toHaveTextContent('open');
    await expectNoBlockingAxeViolations(container);
  });

  it('marks the current profile in the table, and says how to move to another', async () => {
    renderFor({ actor: 'session', role: 'admin', mode: 'enforced', profile: 'team' });
    const table = await screen.findByRole('table', { name: 'Deployment profiles' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
    expect(screen.getByTestId('deployment-change')).toHaveTextContent('--profile');
  });

  it('reads an API from before profiles as solo, rather than failing the page', async () => {
    renderFor({ actor: 'anonymous', role: 'admin', mode: 'open' });
    expect(await screen.findByTestId('deployment-status')).toHaveTextContent('Solo');
  });

  it('says plainly what sign-in an enforced install offers today', async () => {
    renderFor({ actor: 'session', role: 'admin', mode: 'enforced', profile: 'startup' });
    await waitFor(() =>
      expect(screen.getByTestId('deployment-identity')).toHaveTextContent('access tokens'),
    );
    expect(screen.getByTestId('deployment-access')).toHaveTextContent('enforced');
    expect(
      within(screen.getByTestId('deployment-status')).getByRole('link', { name: 'Issue access' }),
    ).toHaveAttribute('href', '/dashboard/access');
  });

  it('says when this browser came in through Cloudflare Access', async () => {
    renderFor({
      actor: 'cf:ana@example.com',
      role: 'operator',
      mode: 'enforced',
      profile: 'startup',
      source: 'cloudflare',
    });
    await waitFor(() =>
      expect(screen.getByTestId('deployment-identity')).toHaveTextContent(
        'You are signed in through Cloudflare Access',
      ),
    );
  });

  it('offers the workspace switcher, and the create form only to a team admin', async () => {
    const admin = makeAdminDouble(true);
    const health = makeHealthDouble('admin', {
      whoami: vi.fn(async () => ({
        actor: 'session',
        role: 'admin' as const,
        mode: 'enforced' as const,
        profile: 'team' as const,
      })),
    });
    render(<DeploymentPage health={health} admin={admin} />);
    expect(await screen.findByLabelText('Current workspace')).toHaveValue('default');
    expect(screen.getByRole('form', { name: 'New workspace' })).toBeInTheDocument();
  });

  it('keeps the create form from a startup install, where one workspace is the shape', async () => {
    const admin = makeAdminDouble();
    const health = makeHealthDouble('admin', {
      whoami: vi.fn(async () => ({
        actor: 'session',
        role: 'admin' as const,
        mode: 'enforced' as const,
        profile: 'startup' as const,
      })),
    });
    render(<DeploymentPage health={health} admin={admin} />);
    expect(await screen.findByLabelText('Current workspace')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New workspace' })).not.toBeInTheDocument();
  });

  it('describes every profile in one sentence, smallest first', () => {
    expect(
      (['solo', 'startup', 'team', 'enterprise'] as const).map((p) => describeProfile(p).label),
    ).toEqual(['Solo', 'Startup', 'Team', 'Enterprise']);
  });
});
