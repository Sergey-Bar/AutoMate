import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditPage, MembersPage } from './People.js';
import { makeHealthDouble } from '../test-utils.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import type { AdminClient } from '../lib/admin-client.js';

const MEMBERS = [
  {
    userId: '00000000-0000-4000-8000-0000000000a1',
    email: 'ana@example.com',
    displayName: 'Ana',
    role: 'admin' as const,
    disabled: false,
    lastLoginAt: '2026-10-27T10:00:00.000Z',
    joinedAt: '2026-10-01T10:00:00.000Z',
  },
  {
    userId: '00000000-0000-4000-8000-0000000000b2',
    email: 'bo@example.com',
    displayName: 'Bo',
    role: 'viewer' as const,
    disabled: true,
    lastLoginAt: null,
    joinedAt: '2026-10-02T10:00:00.000Z',
  },
];

function admin(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    listMembers: vi.fn(async () => MEMBERS),
    updateMember: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    listAudit: vi.fn(async () => ({
      events: [
        {
          seq: 2,
          timestamp: '2026-10-27T10:00:00.000Z',
          actorId: 'user:ana',
          action: 'member.role',
          resourceType: 'user',
          resourceId: 'bo',
          ip: '192.168.1.7',
        },
      ],
      next: null,
    })),
    verifyAudit: vi.fn(async () => ({
      intact: true,
      breaks: [],
      head: { seq: 2, hash: 'ab'.repeat(32) },
    })),
    exportUrl: (format) => `/api/v1/audit/export${format === 'csv' ? '?format=csv' : ''}`,
    addMember: vi.fn(async () => undefined),
    listWorkspaces: vi.fn(async () => ({
      current: 'default-workspace',
      workspaces: [],
      canCreate: false,
    })),
    selectWorkspace: vi.fn(async () => undefined),
    createWorkspace: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('the members page', () => {
  it('lists people with their role, says who is disabled, and has no axe violations', async () => {
    const { container } = render(
      <MembersPage health={makeHealthDouble('admin')} admin={admin()} />,
    );
    const table = await screen.findByRole('table', { name: 'Members' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('ana@example.com'),
      expect.stringContaining('disabled'),
    ]);
    await expectNoBlockingAxeViolations(container);
  });

  it('changes a role, disables, and removes, then reads the list again', async () => {
    const client = admin();
    render(<MembersPage health={makeHealthDouble('admin')} admin={client} />);
    const role = await screen.findByLabelText('Role for bo@example.com');
    fireEvent.change(role, { target: { value: 'operator' } });
    await waitFor(() =>
      expect(client.updateMember).toHaveBeenCalledWith(MEMBERS[1]?.userId, { role: 'operator' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enable bo@example.com' }));
    await waitFor(() =>
      expect(client.updateMember).toHaveBeenCalledWith(MEMBERS[1]?.userId, { disabled: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove bo@example.com' }));
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith(MEMBERS[1]?.userId));
    expect(vi.mocked(client.listMembers).mock.calls.length).toBeGreaterThan(1);
  });

  it('shows the server’s own sentence when a change is refused', async () => {
    const client = admin({
      updateMember: vi.fn(async () => {
        throw Object.assign(new Error('409'), { detail: 'This is the last admin here' });
      }),
    });
    render(<MembersPage health={makeHealthDouble('admin')} admin={client} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disable ana@example.com' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is the last admin here');
  });

  it('adds a person who has signed in before, with a role, then reads the list again', async () => {
    const client = admin();
    render(<MembersPage health={makeHealthDouble('admin')} admin={client} />);
    const form = await screen.findByRole('form', { name: 'Add a person' });
    fireEvent.change(within(form).getByLabelText('Email'), {
      target: { value: 'cy@example.com' },
    });
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'operator' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(client.addMember).toHaveBeenCalledWith('cy@example.com', 'operator'),
    );
    await waitFor(() => expect(vi.mocked(client.listMembers).mock.calls.length).toBeGreaterThan(1));
  });

  it('says how people get here when nobody has signed in yet', async () => {
    render(
      <MembersPage
        health={makeHealthDouble('admin')}
        admin={admin({ listMembers: vi.fn(async () => []) })}
      />,
    );
    expect(await screen.findByTestId('members-empty')).toHaveTextContent('single sign-on');
  });
});

describe('the audit page', () => {
  it('shows whether the chain is intact, the newest events, and both exports', async () => {
    const { container } = render(<AuditPage health={makeHealthDouble('admin')} admin={admin()} />);
    expect(await screen.findByTestId('audit-status')).toHaveTextContent('Intact');
    const table = await screen.findByRole('table', { name: 'Audit events' });
    expect(table).toHaveTextContent('member.role');
    expect(table).toHaveTextContent('192.168.1.7');
    expect(screen.getByRole('link', { name: 'Export NDJSON' })).toHaveAttribute(
      'href',
      '/api/v1/audit/export',
    );
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/v1/audit/export?format=csv',
    );
    await expectNoBlockingAxeViolations(container);
  });

  it('names every break in a broken chain', async () => {
    render(
      <AuditPage
        health={makeHealthDouble('admin')}
        admin={admin({
          verifyAudit: vi.fn(async () => ({
            intact: false,
            breaks: [{ seq: 7, problem: 'edited' }],
            head: { seq: 9, hash: 'cd'.repeat(32) },
          })),
        })}
      />,
    );
    const status = await screen.findByTestId('audit-status');
    expect(status).toHaveTextContent('Broken');
    expect(screen.getByTestId('audit-breaks')).toHaveTextContent('Row 7: edited');
  });
});
