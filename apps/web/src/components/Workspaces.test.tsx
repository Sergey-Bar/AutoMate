import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './Workspaces.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import type { AdminClient } from '../lib/admin-client.js';

/** Choosing and creating workspaces (ADR-014, team), from the Deployment page. */
function client(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    listMembers: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    addMember: vi.fn(),
    listAudit: vi.fn(),
    verifyAudit: vi.fn(),
    exportUrl: () => '',
    listWorkspaces: vi.fn(async () => ({
      current: 'default-workspace',
      workspaces: [
        { id: 'default-workspace', name: 'Default workspace', role: 'admin' as const },
        { id: 'mobile', name: 'Mobile', role: 'viewer' as const },
      ],
      // The caller is an admin here, and still the API says no: the form follows the API.
      canCreate: false,
    })),
    selectWorkspace: vi.fn(async () => undefined),
    createWorkspace: vi.fn(async () => undefined),
    ...overrides,
  } as AdminClient;
}

/** The same client, with the API saying this caller may create a workspace. */
function creator(admin: AdminClient): AdminClient {
  return {
    ...admin,
    listWorkspaces: async () => ({ ...(await admin.listWorkspaces()), canCreate: true }),
  };
}

describe('the workspace panel', () => {
  it('lists the workspaces the caller may enter, marks the current one, and switches', async () => {
    const admin = client();
    const onChanged = vi.fn();
    const { container } = render(<WorkspacePanel admin={admin} onChanged={onChanged} />);
    const select = await screen.findByLabelText('Current workspace');
    expect(select).toHaveValue('default-workspace');
    fireEvent.change(select, { target: { value: 'mobile' } });
    await waitFor(() => expect(admin.selectWorkspace).toHaveBeenCalledWith('mobile'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByRole('form', { name: 'New workspace' })).toBeNull();
    await expectNoBlockingAxeViolations(container);
  });

  it('creates a workspace and moves into it, when the caller may', async () => {
    const admin = client();
    const onChanged = vi.fn();
    render(<WorkspacePanel admin={creator(admin)} onChanged={onChanged} />);
    const form = await screen.findByRole('form', { name: 'New workspace' });
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'web' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Web' } });
    fireEvent.submit(form);
    await waitFor(() => expect(admin.createWorkspace).toHaveBeenCalledWith('web', 'Web'));
    await waitFor(() => expect(admin.selectWorkspace).toHaveBeenCalledWith('web'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the server’s sentence when creating is refused', async () => {
    const admin = client({
      createWorkspace: vi.fn(async () => {
        throw Object.assign(new Error('409'), { detail: 'Several workspaces need team' });
      }),
    });
    render(<WorkspacePanel admin={creator(admin)} onChanged={() => undefined} />);
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
    fireEvent.submit(screen.getByRole('form', { name: 'New workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Several workspaces need team');
  });

  it('shows the server’s sentence when a switch is refused, and stays put', async () => {
    const admin = client({
      selectWorkspace: vi.fn(async () => {
        throw Object.assign(new Error('403'), { detail: 'You are not a member of that workspace' });
      }),
    });
    const onChanged = vi.fn();
    render(<WorkspacePanel admin={admin} onChanged={onChanged} />);
    fireEvent.change(await screen.findByLabelText('Current workspace'), {
      target: { value: 'mobile' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are not a member of that workspace',
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('says nothing when the install has no database to hold workspaces', async () => {
    const admin = client({
      listWorkspaces: vi.fn(async () => {
        throw Object.assign(new Error('404'), { status: 404 });
      }),
    });
    const { container } = render(
      <WorkspacePanel admin={creator(admin)} onChanged={() => undefined} />,
    );
    await waitFor(() => expect(admin.listWorkspaces).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
