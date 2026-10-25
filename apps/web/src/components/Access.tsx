import React from 'react';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import { useResource } from '../hooks/useResource.js';
import {
  TOKEN_ROLES,
  type AccessTokenSummary,
  type HealthClient,
  type TokenRole,
  type WhoAmI,
} from '../lib/health-client.js';
import { ago } from '../lib/health-view.js';
import { CopyButton, PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import { ConnectRunnerPanel, PairDevicePanel } from './Pairing.js';

/**
 * Sign-in, and the gate that asks for it.
 *
 * With `ACCESS_CONTROL=open` the API answers `whoami` with the admin and the gate renders its
 * children. Enforced, a caller with no role sees one field: an access token from an admin, or
 * the installation key.
 */
export function AccessGate({
  health,
  children,
}: {
  health: HealthClient;
  children: (who: WhoAmI) => React.ReactNode;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const who = useResource<WhoAmI>(() => health.whoami(), [health, version]);
  if (who.status === 'loading') return <Skeleton className="h-40 w-full" />;
  if (who.status === 'error') {
    return (
      <EmptyState headingLevel={2} title="Could not reach the API" description={who.message} />
    );
  }
  if (who.value.role === null) {
    return <SignIn health={health} onSignedIn={() => setVersion((value) => value + 1)} />;
  }
  return <>{children(who.value)}</>;
}

/**
 * One field, for whoever reaches an install that enforces access control with no
 * credential. Exported for the app-wide gate in `routes/__root.tsx`.
 */
export function SignIn({
  health,
  onSignedIn,
}: {
  health: HealthClient;
  onSignedIn: () => void;
}): React.ReactElement {
  const [credential, setCredential] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    health
      .signIn(credential)
      .then(() => {
        setCredential('');
        onSignedIn();
      })
      .catch((failure: unknown) => {
        const detail = (failure as { detail?: unknown }).detail;
        setError(typeof detail === 'string' ? detail : 'Sign-in failed');
      })
      .finally(() => setBusy(false));
  };
  return (
    <PageFrame data-testid="sign-in" className="h-auto items-center justify-center py-16">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4" aria-label="Sign in">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-fg-muted">
          Paste the access token an admin gave you, or the installation key.
        </p>
        <Input
          id={`${id}-credential`}
          label="Token or key"
          type="password"
          autoComplete="current-password"
          value={credential}
          required
          onChange={(event) => setCredential(event.target.value)}
        />
        {error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy || credential.trim() === ''}
          className="min-h-11 w-full"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </PageFrame>
  );
}

/** Issue and revoke access tokens. An admin's page; the API refuses anyone else. */
export function AccessPage({ health }: { health: HealthClient }): React.ReactElement {
  return (
    <AccessGate health={health}>{(who) => <AccessBody health={health} who={who} />}</AccessGate>
  );
}

function AccessBody({ health, who }: { health: HealthClient; who: WhoAmI }): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const tokens = useResource<AccessTokenSummary[]>(() => health.listTokens(), [health, version]);
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<TokenRole>('viewer');
  const [projectId, setProjectId] = React.useState('');
  const [issued, setIssued] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const describe = (failure: unknown) => {
    const detail = (failure as { detail?: unknown }).detail;
    setError(typeof detail === 'string' ? detail : 'The request failed');
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    health
      .createToken({
        name: name.trim(),
        role,
        ...(projectId.trim() === '' ? {} : { projectId: projectId.trim() }),
      })
      .then((created) => {
        setIssued(created.token);
        setName('');
        setProjectId('');
        setVersion((value) => value + 1);
      })
      .catch(describe);
  };
  return (
    <PageFrame data-testid="access-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Access"
        subtitle={`Signed in as ${who.role ?? 'nobody'} · access control ${who.mode}`}
        actions={
          <Button
            variant="ghost"
            onClick={() => void health.signOut().then(() => window.location.reload())}
          >
            Sign out
          </Button>
        }
      />
      {who.mode === 'open' ? (
        <Quiet data-testid="access-open">
          Access control is open: every caller is the operator. Set AUTOMATE_LAN_MODE=1 (or
          ACCESS_CONTROL=enforced) to require sign-in.
        </Quiet>
      ) : null}
      {who.role === 'admin' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PairDevicePanel health={health} />
          <ConnectRunnerPanel origin={window.location.origin} />
        </div>
      ) : null}
      <Panel title="Issue a token">
        <form
          onSubmit={create}
          className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end"
          aria-label="Issue a token"
        >
          <Input
            id={`${id}-name`}
            label="Name"
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <Select
            id={`${id}-role`}
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value as TokenRole)}
            options={TOKEN_ROLES.map((entry) => ({ value: entry, label: entry }))}
          />
          <Input
            id={`${id}-project`}
            label={role === 'uploader' ? 'Project id (required)' : 'Project id (uploader only)'}
            value={projectId}
            required={role === 'uploader'}
            disabled={role !== 'uploader'}
            onChange={(event) => setProjectId(event.target.value)}
          />
          <Button type="submit" className="min-h-10">
            Issue
          </Button>
        </form>
        {issued === null ? null : (
          <div
            data-testid="issued-token"
            className="mt-3 flex items-center gap-2 rounded-lg border border-border-strong p-3 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-mono">{issued}</span>
            <CopyButton text={issued} label="Copy token" />
            <span className="text-xs text-fg-muted">Shown once.</span>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </Panel>
      <Panel title="Tokens">
        {tokens.status === 'loading' ? (
          <Skeleton className="h-16 w-full" />
        ) : tokens.status === 'error' ? (
          <Quiet role="alert">{tokens.message}</Quiet>
        ) : tokens.value.length === 0 ? (
          <Quiet>No token has been issued.</Quiet>
        ) : (
          <Table aria-label="Access tokens">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Token</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.value.map((token) => (
                <TableRow key={token.id} data-testid={`token-${token.id}`}>
                  <TableCell>{token.name}</TableCell>
                  <TableCell>
                    <Badge variant={token.revokedAt === null ? 'outline' : 'secondary'}>
                      {token.revokedAt === null ? token.role : `${token.role} · revoked`}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {token.displayPrefix}…
                  </TableCell>
                  <TableCell className="hidden text-xs text-fg-muted sm:table-cell">
                    {ago(token.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    {token.revokedAt === null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          health
                            .revokeToken(token.id)
                            .then(() => setVersion((value) => value + 1))
                            .catch(describe);
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </PageFrame>
  );
}
