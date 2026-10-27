import React from 'react';
import { Button, Input } from '@automate/ui';
import { useResource } from '../hooks/useResource.js';
import type { AdminClient, WorkspaceEntry } from '../lib/admin-client.js';
import { Panel } from './kit.js';

/**
 * Which workspace you are in, switching to another you may enter, and creating one (ADR-014,
 * team). A switch is remembered by the API in a cookie, and the page reloads so every screen
 * reads the new workspace. Renders nothing on an install that has no workspaces to choose
 * from: one without a database answers the list with an error.
 */
function describe(failure: unknown): string {
  const detail = (failure as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  return failure instanceof Error ? failure.message : 'The request failed';
}

export function WorkspacePanel({
  admin,
  canCreate,
  onChanged,
}: {
  admin: AdminClient;
  /** Whether to offer the create form: an admin, on the team or enterprise profile. */
  canCreate: boolean;
  /** Called after a switch, to reload what the page shows. */
  onChanged: () => void;
}): React.ReactElement | null {
  const list = useResource<{ current: string; workspaces: WorkspaceEntry[] }>(
    () => admin.listWorkspaces(),
    [admin],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [id, setId] = React.useState('');
  const [name, setName] = React.useState('');
  const field = React.useId();
  if (list.status !== 'ready') return null;

  const enter = (workspaceId: string) => {
    setError(null);
    admin
      .selectWorkspace(workspaceId)
      .then(onChanged)
      .catch((failure: unknown) => setError(describe(failure)));
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    admin
      .createWorkspace(id.trim(), name.trim())
      .then(() => admin.selectWorkspace(id.trim()))
      .then(onChanged)
      .catch((failure: unknown) => setError(describe(failure)));
  };
  return (
    <Panel title="Workspace">
      <label htmlFor={`${field}-current`} className="mb-1 block text-sm font-medium">
        Current workspace
      </label>
      <select
        id={`${field}-current`}
        value={list.value.current}
        onChange={(event) => enter(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-border bg-surface px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        {list.value.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {`${workspace.name} (${workspace.role})`}
          </option>
        ))}
      </select>
      <p className="mt-2 max-w-measure text-xs text-fg-muted">
        Each workspace has its own projects, runs, tokens, members and audit trail. Your role can
        differ from one to the next.
      </p>
      {canCreate ? (
        <form
          aria-label="New workspace"
          onSubmit={create}
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
        >
          <Input
            id={`${field}-id`}
            label="Id"
            value={id}
            required
            pattern="[a-z0-9][a-z0-9-]*"
            onChange={(event) => setId(event.target.value)}
          />
          <Input
            id={`${field}-name`}
            label="Name"
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" className="min-h-10">
            Create
          </Button>
        </form>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}
