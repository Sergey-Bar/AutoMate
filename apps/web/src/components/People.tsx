import React from 'react';
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import { useResource, type Resource } from '../hooks/useResource.js';
import type { AdminClient, AuditEvent, AuditVerification, Member } from '../lib/admin-client.js';
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
      <AddPerson onAdd={(email, role) => act(admin.addMember(email, role))} />
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

/** Gives a person who has signed in before a role in this workspace. */
function AddPerson({
  onAdd,
}: {
  onAdd: (email: string, role: Member['role']) => void;
}): React.ReactElement {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Member['role']>('viewer');
  const field = React.useId();
  return (
    <Panel title="Add a person">
      <form
        aria-label="Add a person"
        className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(email.trim(), role);
          setEmail('');
        }}
      >
        <Input
          id={`${field}-email`}
          label="Email"
          type="email"
          value={email}
          required
          onChange={(event) => setEmail(event.target.value)}
        />
        <div>
          <label htmlFor={`${field}-role`} className="mb-1 block text-sm font-medium">
            Role
          </label>
          <select
            id={`${field}-role`}
            value={role}
            onChange={(event) => setRole(event.target.value as Member['role'])}
            className="min-h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" className="min-h-10">
          Add
        </Button>
      </form>
      <p className="mt-2 max-w-measure text-xs text-fg-muted">
        The person must have signed in with single sign-on once. People an identity provider
        provisions over SCIM appear without this.
      </p>
    </Panel>
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
      <AuditVerdict verdict={verdict} />
      <Panel title="Newest events">
        <AuditEvents page={page} />
      </Panel>
    </PageFrame>
  );
}

/** What the chain check says, in one sentence. */
function verdictSentence(value: AuditVerification): string {
  if (!value.intact) return 'Some rows were changed or removed after they were written.';
  const upTo = value.head === null ? '' : `, up to row ${String(value.head.seq)}`;
  return `Every row matches its hash and links to the one before it${upTo}.`;
}

function AuditVerdict({ verdict }: { verdict: Resource<AuditVerification> }): React.ReactElement {
  if (verdict.status === 'loading') return <Skeleton className="h-24 w-full" />;
  if (verdict.status === 'error') return <Quiet role="alert">{verdict.message}</Quiet>;
  const { value } = verdict;
  return (
    <>
      <StatusLine
        data-testid="audit-status"
        value={value.intact ? 'Intact' : 'Broken'}
        sentence={verdictSentence(value)}
        tone={value.intact ? 'good' : 'bad'}
      />
      {value.breaks.length === 0 ? null : (
        <ul data-testid="audit-breaks" className="space-y-1 text-sm text-danger">
          {value.breaks.map((item) => (
            <li key={`${String(item.seq)}-${item.problem}`}>
              Row {item.seq}: {item.problem}
            </li>
          ))}
        </ul>
      )}
      {value.head === null ? null : (
        <p className="max-w-measure break-all font-mono text-xs text-fg-muted">
          Head {value.head.hash}. Keep it with each export: it proves later that the trail was not
          rewritten from this point.
        </p>
      )}
    </>
  );
}

function AuditEvents({
  page,
}: {
  page: Resource<{ events: AuditEvent[]; next: number | null }>;
}): React.ReactElement {
  if (page.status === 'loading') return <Skeleton className="h-16 w-full" />;
  if (page.status === 'error') return <Quiet role="alert">{page.message}</Quiet>;
  if (page.value.events.length === 0) return <Quiet>Nothing has been recorded yet.</Quiet>;
  return (
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
            <TableCell className="font-mono text-xs text-fg-muted">{event.ip ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
