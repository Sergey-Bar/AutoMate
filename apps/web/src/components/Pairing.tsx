import React from 'react';
import { Button, Input, Select } from '@automate/ui';
import type { HealthClient, PairingCode } from '../lib/health-client.js';
import { CopyButton, PageFrame, Panel, Quiet } from './kit.js';
import { QrCode } from './QrCode.js';

function failureText(failure: unknown, fallback: string): string {
  const detail = (failure as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : fallback;
}

/**
 * Pair a phone, tablet or laptop: one name, one role, one button, then a code big enough
 * to read across a desk and a QR code that opens the pairing page with it filled in.
 */
export function PairDevicePanel({ health }: { health: HealthClient }): React.ReactElement {
  const [deviceName, setDeviceName] = React.useState('');
  const [role, setRole] = React.useState<'viewer' | 'operator'>('viewer');
  const [issued, setIssued] = React.useState<PairingCode | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    health
      .issuePairingCode({ deviceName: deviceName.trim(), role })
      .then((code) => {
        setIssued(code);
        setDeviceName('');
      })
      .catch((failure: unknown) => setError(failureText(failure, 'Could not issue a code')));
  };
  return (
    <Panel title="Pair a device" data-testid="pair-device">
      <form
        onSubmit={submit}
        className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
        aria-label="Pair a device"
      >
        <Input
          id={`${id}-device`}
          label="Device name"
          placeholder="Kitchen iPad"
          value={deviceName}
          required
          onChange={(event) => setDeviceName(event.target.value)}
        />
        <Select
          id={`${id}-role`}
          label="Device role"
          value={role}
          onChange={(event) => setRole(event.target.value as 'viewer' | 'operator')}
          options={[
            { value: 'viewer', label: 'viewer' },
            { value: 'operator', label: 'operator' },
          ]}
        />
        <Button type="submit" className="min-h-10" disabled={deviceName.trim() === ''}>
          Get a code
        </Button>
      </form>
      {issued === null ? null : (
        <div
          data-testid="pairing-code"
          className="mt-4 flex animate-fade-in flex-col items-center gap-4 sm:flex-row"
        >
          <QrCode
            value={issued.pairUrl}
            label={`Pairing link for ${issued.deviceName}`}
            className="size-40 shrink-0 rounded-lg bg-surface p-2 text-fg"
          />
          <div className="space-y-2 text-center sm:text-left">
            <p
              className="font-mono text-5xl font-semibold tracking-widest tabular-nums"
              aria-label={`Code ${issued.code.split('').join(' ')}`}
            >
              {issued.code}
            </p>
            <p className="text-sm text-fg-muted">
              Scan it, or open <span className="font-mono">/dashboard/pair</span> on the device and
              type the code. It works once, for ten minutes, as {issued.role}.
            </p>
            <CopyButton text={issued.pairUrl} label="Copy pairing link" />
          </div>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}

/**
 * What a second machine needs to run jobs for this server: the address, and the two
 * variables the runner reads. The address is the one this browser used, which is by
 * construction one another machine on the network can reach.
 */
export function ConnectRunnerPanel({ origin }: { origin: string }): React.ReactElement {
  const snippet = [
    `AUTOMATE_API_URL=${origin}`,
    'RUNNER_REGISTRATION_SECRET=<RUNNER_REGISTRATION_SECRET from the server .env>',
    'RUNNER_INSTANCE_ID=<a new UUID for this machine>',
  ].join('\n');
  return (
    <Panel title="Connect a runner" data-testid="connect-runner">
      <p className="text-sm text-fg-muted">
        Run jobs on another machine. Set these in its environment and start the runner image.
        {origin.startsWith('https://')
          ? ''
          : ' This address is plain HTTP, so the runner refuses it: issue a LAN certificate first.'}
      </p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs">
        {snippet}
      </pre>
      <CopyButton text={snippet} label="Copy runner settings" />
    </Panel>
  );
}

/**
 * The page a pairing link opens. The code arrives in the query string from a QR scan, or
 * is typed; either way one button spends it and the device lands on the dashboard.
 */
export function PairPage({
  health,
  initialCode,
  onPaired,
}: {
  health: HealthClient;
  initialCode: string;
  onPaired: () => void;
}): React.ReactElement {
  const [code, setCode] = React.useState(initialCode);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    health
      .pair(code)
      .then(onPaired)
      .catch((failure: unknown) => setError(failureText(failure, 'That code did not work')))
      .finally(() => setBusy(false));
  };
  return (
    <PageFrame data-testid="pair-page" className="h-auto items-center justify-center py-16">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4" aria-label="Pair this device">
        <h1 className="text-3xl font-semibold tracking-tight">Pair this device</h1>
        <Quiet>Type the six digits shown on the Access page of the server.</Quiet>
        <Input
          id={`${id}-code`}
          label="Pairing code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          required
          onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
        />
        {error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="min-h-11 w-full" disabled={busy || code.length !== 6}>
          {busy ? 'Pairing…' : 'Pair'}
        </Button>
      </form>
    </PageFrame>
  );
}
