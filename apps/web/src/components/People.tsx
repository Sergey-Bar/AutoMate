import React from 'react';
import {
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import { useResource } from '../hooks/useResource.js';
import type { AdminClient, AuditVerification, Member } from '../lib/admin-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { ago } from '../lib/health-view.js';
import { AccessGate } from './Access.js';
import { PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import { StatusLine } from './StatusLine.js';

/**
 * People and the audit trail (ADR-014, team and enterprise). Both pages are an admin's: the
 * API refuses anyone else, and the gate signs a browser in first.
 */
const ROLES: readonly Member['role'][] = ['viewer', 'operator', 'admin'];

function describe(failure: unknown): string {
  const detail = (failure as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  return failure instanceof Error ? failure.message : 'The request failed';
}

export function MembersPage({
  health,
  admin,
}: {
  health: HealthClient;
  admin: AdminClient;
}): React.ReactElement {
  return <AccessGate health={health}>{() => <MembersBody admin={admin} />}</AccessGate>;
}

function MembersBody({ admin }: { admin: AdminClient }): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const members = useResource<Member[]>(() => admin.listMembers(), [admin, version]);
  const [error, setError] = React.useState<string | null>(null);
  const act = (work: Promise<void>) => {
    setError(null);
    work
      .then(() => setVersion((value) => value + 1))
      .catch((failure: unknown) => setError(describe(failure)));
  };
  return (
    <PageFrame data-testid="members-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader title="Members" subtitle="The people who signed in, and what each may do here" />
      {error === null ? null : (
        <p role="alert" className="max-w-measure text-sm text-danger">
          {error}
        </p>
      )}
      <Panel title="People">
        {members.status === 'loading' ? (
          <Skeleton className="h-16 w-full" />
        ) : members.status === 'error' ? (
          <Quiet role="alert">{members.message}</Quiet>
        ) : members.value.length === 0 ? (
          <Quiet data-testid="members-empty">
            Nobody has signed in with single sign-on yet. People appear here the first time they
            sign in; access tokens are on the Access page.
          </Quiet>
        ) : (
          <Table aria-label="Members">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.value.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <span className="font-medium">{member.displayName}</span>{' '}
                    <span className="text-fg-muted">{member.email}</span>
                    {member.disabled ? (
                      <Badge variant="secondary" className="ml-2">
                        disabled
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <label className="sr-only" htmlFor={`role-${member.userId}`}>
                      Role for {member.email}
                    </label>
                    <select
                      id={`role-${member.userId}`}
                      value={member.role}
                      onChange={(event) =>
                        act(
                          admin.updateMember(member.userId, {
                            role: event.target.value as Member['role'],
                          }),
                        )
                      }
                      className="min-h-11 rounded-lg border border-border bg-surface px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {member.lastLoginAt === null ? 'never' : ago(member.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      aria-label={`${member.disabled ? 'Enable' : 'Disable'} ${member.email}`}
                      onClick={() =>
                        act(admin.updateMember(member.userId, { disabled: !member.disabled }))
                      }
                    >
                      {member.disabled ? 'Enable' : 'Disable'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      aria-label={`Remove ${member.email}`}
                      onClick={() => act(admin.removeMember(member.userId))}
                    >
                      Remove
                    </Button>
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

export function AuditPage({
  health,
  admin,
}: {
  health: HealthClient;
  admin: AdminClient;
}): React.ReactElement {
  return <AccessGate health={health}>{() => <AuditBody admin={admin} />}</AccessGate>;
}

function AuditBody({ admin }: { admin: AdminClient }): React.ReactElement {
  const verdict = useResource<AuditVerification>(() => admin.verifyAudit(), [admin]);
  const page = useResource(() => admin.listAudit(), [admin]);
  return (
    <PageFrame data-testid="audit-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Audit trail"
        subtitle="Every decision, chained to the one before it"
        actions={
          <>
            <a
              href={admin.exportUrl('ndjson')}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Export NDJSON
            </a>
            <a
              href={admin.exportUrl('csv')}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Export CSV
            </a>
          </>
        }
      />
      {verdict.status === 'ready' ? (
        <>
          <StatusLine
            data-testid="audit-status"
            value={verdict.value.intact ? 'Intact' : 'Broken'}
            sentence={
              verdict.value.intact
                ? `Every row matches its hash and links to the one before it${
                    verdict.value.head === null
                      ? '.'
                      : `, up to row ${String(verdict.value.head.seq)}.`
                  }`
                : 'Some rows were changed or removed after they were written.'
            }
            tone={verdict.value.intact ? 'good' : 'bad'}
          />
          {verdict.value.breaks.length === 0 ? null : (
            <ul data-testid="audit-breaks" className="space-y-1 text-sm text-danger">
              {verdict.value.breaks.map((item) => (
                <li key={`${String(item.seq)}-${item.problem}`}>
                  Row {item.seq}: {item.problem}
                </li>
              ))}
            </ul>
          )}
          {verdict.value.head === null ? null : (
            <p className="max-w-measure break-all font-mono text-xs text-fg-muted">
              Head {verdict.value.head.hash}. Keep it with each export: it proves later that the
              trail was not rewritten from this point.
            </p>
          )}
        </>
      ) : verdict.status === 'error' ? (
        <Quiet role="alert">{verdict.message}</Quiet>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
      <Panel title="Newest events">
        {page.status === 'loading' ? (
          <Skeleton className="h-16 w-full" />
        ) : page.status === 'error' ? (
          <Quiet role="alert">{page.message}</Quiet>
        ) : page.value.events.length === 0 ? (
          <Quiet>Nothing has been recorded yet.</Quiet>
        ) : (
          <Table aria-label="Audit events">
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.value.events.map((event) => (
                <TableRow key={`${String(event.seq)}-${event.timestamp}`}>
                  <TableCell className="tabular-nums">{event.seq ?? '—'}</TableCell>
                  <TableCell className="text-fg-muted">{ago(event.timestamp)}</TableCell>
                  <TableCell className="font-mono text-xs">{event.actorId}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{event.action}</span>
                    {event.resourceId === null ? null : (
                      <span className="text-fg-muted"> · {event.resourceId}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-fg-muted">
                    {event.ip ?? '—'}
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
