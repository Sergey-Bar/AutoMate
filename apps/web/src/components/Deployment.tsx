import React from 'react';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@automate/ui';
import type { HealthClient, WhoAmI } from '../lib/health-client.js';
import { AccessGate } from './Access.js';
import { PageFrame, PageHeader, Panel } from './kit.js';
import { StatusLine } from './StatusLine.js';

export type Profile = NonNullable<WhoAmI['profile']>;

const PROFILE_ORDER: readonly Profile[] = ['solo', 'startup', 'team', 'enterprise'];

interface ProfileDescription {
  label: string;
  /** Who it is for, in one sentence. */
  audience: string;
  /** What the profile turns on beyond the one before it. */
  adds: string;
  next: { label: string; href: string };
}

/**
 * The four profiles (ADR-014), in words a person choosing one can act on. Written to say
 * only what this build does: user accounts and single sign-on are the team and enterprise
 * milestones, and until they land the page says sign-in is access tokens and pairing.
 */
const PROFILES: Record<Profile, ProfileDescription> = {
  solo: {
    label: 'Solo',
    audience: 'One person, on this machine. No sign-in.',
    adds: 'Loopback only; every caller is the operator.',
    next: { label: 'Open your projects', href: '/dashboard/portfolio' },
  },
  startup: {
    label: 'Startup',
    audience: 'A small team on one network, or remote through Cloudflare.',
    adds: 'Sign-in required, access tokens with roles, device pairing.',
    next: { label: 'Issue access', href: '/dashboard/access' },
  },
  team: {
    label: 'Team',
    audience: 'Several teams sharing one install.',
    adds: 'User accounts, single sign-on and a workspace per team.',
    next: { label: 'Issue access', href: '/dashboard/access' },
  },
  enterprise: {
    label: 'Enterprise',
    audience: 'An organisation with an identity provider and auditors.',
    adds: 'Enforced single sign-on, provisioning and an exportable audit log.',
    next: { label: 'Issue access', href: '/dashboard/access' },
  },
};

export function describeProfile(profile: Profile): ProfileDescription {
  return PROFILES[profile];
}

/** What this install is for, how it lets people in, and how to change it. */
export function DeploymentPage({ health }: { health: HealthClient }): React.ReactElement {
  return <AccessGate health={health}>{(who) => <DeploymentBody who={who} />}</AccessGate>;
}

function DeploymentBody({ who }: { who: WhoAmI }): React.ReactElement {
  const profile: Profile = who.profile ?? 'solo';
  const current = describeProfile(profile);
  return (
    <PageFrame data-testid="deployment-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader title="Deployment" subtitle="What this install is for, and who it lets in" />
      <StatusLine
        data-testid="deployment-status"
        value={current.label}
        sentence={current.audience}
        tone="good"
        action={current.next}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Access control">
          <p data-testid="deployment-access" className="text-sm">
            Access control is <span className="font-mono">{who.mode}</span>.{' '}
            {who.mode === 'open'
              ? 'Anyone who can reach this install acts as the operator, which is why it stays on this machine.'
              : 'Every request needs a credential, and each credential carries a role.'}
          </p>
        </Panel>
        <Panel title="Sign-in">
          <p data-testid="deployment-identity" className="text-sm">
            {who.mode === 'open'
              ? 'None: there is one person, and it is you.'
              : who.source === 'cloudflare'
                ? 'You are signed in through Cloudflare Access; your role comes from the role map on this install. Access tokens, paired devices and the installation key work too.'
                : 'Sign in with access tokens issued by an admin, a paired device, or the installation key.'}
          </p>
        </Panel>
      </div>
      <Panel title="Profiles">
        <Table aria-label="Deployment profiles">
          <TableHeader>
            <TableRow>
              <TableHead>Profile</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Turns on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PROFILE_ORDER.map((candidate) => {
              const description = describeProfile(candidate);
              const isCurrent = candidate === profile;
              return (
                <TableRow key={candidate} aria-current={isCurrent ? 'true' : undefined}>
                  <TableCell className="font-medium">
                    {description.label}
                    {isCurrent ? (
                      <Badge variant="outline" className="ml-2">
                        current
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{description.audience}</TableCell>
                  <TableCell>{description.adds}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p data-testid="deployment-change" className="mt-3 max-w-measure text-xs text-fg-muted">
          To change the profile, run <span className="font-mono">./start.sh --profile team</span>{' '}
          (or <span className="font-mono">.\start.cmd --profile team</span> on Windows) in the
          install folder. Your data and secrets are kept.
        </p>
      </Panel>
    </PageFrame>
  );
}
