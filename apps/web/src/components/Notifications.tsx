import React from 'react';
import {
  Badge,
  Button,
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
import type {
  ChannelKind,
  ChannelSummary,
  CreateChannelBody,
  DeliverySummary,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { NotificationsClient } from '../lib/notifications-client.js';
import { ago } from '../lib/health-view.js';
import { PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import { useToast } from './Toasts.js';

/**
 * Scheduled reports, set up in under a minute.
 *
 * Three steps on one page, in the order a person does them: where (a channel), when (a
 * schedule), and did it work (the history, which is also the in-app inbox). The built-in
 * inbox needs no account anywhere, so reports can be seen working before any platform is
 * connected.
 */

interface KindGuide {
  label: string;
  /** Five steps or fewer, in plain words. */
  help: string;
  /** The public settings this kind needs, as form fields. */
  fields: ReadonlyArray<{ key: string; label: string; placeholder: string }>;
  /** What the credential is called on this platform; absent for the inbox. */
  credentialLabel?: string;
}

export const KIND_GUIDES: Record<ChannelKind, KindGuide> = {
  inbox: {
    label: 'Automate inbox',
    help: 'Reports are kept here, on this page. No account needed — a good first channel.',
    fields: [],
  },
  slack: {
    label: 'Slack',
    help: 'Create a Slack app with the chat:write scope, install it, invite the bot to the channel, then paste the Bot User OAuth Token.',
    fields: [{ key: 'channel', label: 'Channel', placeholder: '#quality' }],
    credentialLabel: 'Bot token (xoxb-…)',
  },
  teams: {
    label: 'Microsoft Teams',
    help: 'In the channel, open Workflows → "Post to a channel when a webhook request is received", finish the wizard, and paste the URL it gives you.',
    fields: [],
    credentialLabel: 'Workflows webhook URL',
  },
  telegram: {
    label: 'Telegram',
    help: 'Message @BotFather, send /newbot, and paste the token. Add the bot to your group, send it a message, and use the chat id from getUpdates (groups start with -100).',
    fields: [{ key: 'chatId', label: 'Chat id', placeholder: '-1001234567890' }],
    credentialLabel: 'Bot token',
  },
  whatsapp: {
    label: 'WhatsApp',
    help: 'Needs a Meta Business account and the Cloud API. Create a template with one body variable ({{1}}), wait for approval, then paste a system-user access token.',
    fields: [
      { key: 'phoneNumberId', label: 'Phone number id', placeholder: '123456789012345' },
      { key: 'to', label: 'Send to (digits only)', placeholder: '15551234567' },
      { key: 'template', label: 'Template name', placeholder: 'automate_report' },
      { key: 'language', label: 'Template language', placeholder: 'en_US' },
    ],
    credentialLabel: 'Access token',
  },
  signal: {
    label: 'Signal',
    help: 'Start the signal bridge (docker compose --profile signal up -d), link it to a Signal account once, then use http://signal:8080 as the bridge URL.',
    fields: [
      { key: 'number', label: 'Bridge account', placeholder: '+15551234567' },
      { key: 'recipients', label: 'Recipients (comma-separated)', placeholder: '+15557654321' },
    ],
    credentialLabel: 'Bridge URL',
  },
};

const KINDS = Object.keys(KIND_GUIDES) as ChannelKind[];

function failure(error: unknown, fallback: string): string {
  const detail = (error as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : fallback;
}

function AddChannel({
  client,
  onAdded,
}: {
  client: NotificationsClient;
  onAdded: () => void;
}): React.ReactElement {
  const toast = useToast();
  const [kind, setKind] = React.useState<ChannelKind>('inbox');
  const [name, setName] = React.useState('');
  const [settings, setSettings] = React.useState<Record<string, string>>({});
  const [secret, setSecret] = React.useState('');
  const id = React.useId();
  const guide = KIND_GUIDES[kind];
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = {
      kind,
      name: name.trim() || guide.label,
      settings,
      ...(guide.credentialLabel === undefined ? {} : { secret: secret.trim() }),
    } as CreateChannelBody;
    client
      .createChannel(body)
      .then((channel) => {
        toast({ tone: 'success', title: `${channel.name} added` });
        setName('');
        setSettings({});
        setSecret('');
        onAdded();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Could not add the channel',
          description: failure(error, 'The request failed'),
        }),
      );
  };
  return (
    <form onSubmit={submit} aria-label="Add a channel" className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          id={`${id}-kind`}
          label="Where"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as ChannelKind);
            setSettings({});
          }}
          options={KINDS.map((value) => ({ value, label: KIND_GUIDES[value].label }))}
        />
        <Input
          id={`${id}-name`}
          label="Name"
          placeholder={guide.label}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {guide.fields.map((field) => (
          <Input
            key={field.key}
            id={`${id}-${field.key}`}
            label={field.label}
            placeholder={field.placeholder}
            value={settings[field.key] ?? ''}
            required
            onChange={(event) =>
              setSettings((current) => ({ ...current, [field.key]: event.target.value }))
            }
          />
        ))}
        {guide.credentialLabel === undefined ? null : (
          <Input
            id={`${id}-secret`}
            label={guide.credentialLabel}
            type="password"
            autoComplete="off"
            value={secret}
            required
            onChange={(event) => setSecret(event.target.value)}
          />
        )}
      </div>
      <p className="text-sm text-fg-muted" data-testid="kind-help">
        {guide.help}
      </p>
      <div>
        <Button type="submit" className="min-h-10">
          Add {guide.label}
        </Button>
      </div>
    </form>
  );
}

function Channels({
  client,
  channels,
  onChanged,
}: {
  client: NotificationsClient;
  channels: ChannelSummary[];
  onChanged: () => void;
}): React.ReactElement {
  const toast = useToast();
  const test = (channel: ChannelSummary) => {
    client
      .testChannel(channel.id)
      .then((delivery) => {
        const sent = delivery?.status === 'sent';
        toast({
          tone: sent ? 'success' : delivery?.status === 'failed' ? 'danger' : 'info',
          title: sent ? `Test sent to ${channel.name}` : `Test queued for ${channel.name}`,
          ...(delivery?.errorCode == null ? {} : { description: delivery.errorCode }),
        });
        onChanged();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Test failed',
          description: failure(error, 'The request failed'),
        }),
      );
  };
  const remove = (channel: ChannelSummary) => {
    client
      .deleteChannel(channel.id)
      .then(() => {
        toast({ tone: 'info', title: `${channel.name} removed` });
        onChanged();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Could not remove it',
          description: failure(error, 'The request failed'),
        }),
      );
  };
  if (channels.length === 0) return <Quiet>No channel yet. Start with the Automate inbox.</Quiet>;
  return (
    <ul className="divide-y divide-border" aria-label="Channels">
      {channels.map((channel) => (
        <li
          key={channel.id}
          className="flex items-center justify-between gap-2 py-2"
          data-testid={`channel-${channel.id}`}
        >
          <span className="min-w-0 truncate">
            <span className="font-medium">{channel.name}</span>{' '}
            <span className="text-xs text-fg-muted">{KIND_GUIDES[channel.kind].label}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => test(channel)}>
              Send a test
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove(channel)}>
              Remove
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

const PRESETS = [
  { id: 'daily', label: 'Daily 09:00', cadence: 'daily' as const, weekday: 1 },
  { id: 'weekly', label: 'Weekly, Monday 09:00', cadence: 'weekly' as const, weekday: 1 },
  { id: 'custom', label: 'Custom', cadence: 'custom' as const, weekday: 1 },
];

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function Schedules({
  client,
  channels,
  onChanged,
  version,
}: {
  client: NotificationsClient;
  channels: ChannelSummary[];
  onChanged: () => void;
  version: number;
}): React.ReactElement {
  const toast = useToast();
  const subscriptions = useResource(() => client.listSubscriptions(), [client, version]);
  const [preset, setPreset] = React.useState<(typeof PRESETS)[number]['id']>('daily');
  const [channelId, setChannelId] = React.useState('');
  const [time, setTime] = React.useState('09:00');
  const [cronExpr, setCronExpr] = React.useState('0 9 * * 1-5');
  const [timezone, setTimezone] = React.useState(browserTimezone);
  const id = React.useId();
  const chosen = PRESETS.find((entry) => entry.id === preset) ?? PRESETS[0];
  const target = channelId === '' ? (channels[0]?.id ?? '') : channelId;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    client
      .createSubscription({
        channelId: target,
        cadence: chosen?.cadence ?? 'daily',
        time,
        weekday: chosen?.weekday ?? 1,
        timezone,
        ...(chosen?.cadence === 'custom' ? { cronExpr } : {}),
      })
      .then((created) => {
        toast({ tone: 'success', title: 'Report scheduled', description: created.describe });
        onChanged();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Could not schedule it',
          description: failure(error, 'The request failed'),
        }),
      );
  };
  const remove = (subscriptionId: string) => {
    client
      .deleteSubscription(subscriptionId)
      .then(onChanged)
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Could not remove it',
          description: failure(error, 'The request failed'),
        }),
      );
  };
  const nameOf = (channelKey: string) =>
    channels.find((channel) => channel.id === channelKey)?.name ?? 'a removed channel';
  return (
    <div className="grid gap-4">
      {channels.length === 0 ? (
        <Quiet>Add a channel first.</Quiet>
      ) : (
        <form onSubmit={submit} aria-label="Schedule a report" className="grid gap-3">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">How often</legend>
            {PRESETS.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                size="sm"
                variant={entry.id === preset ? 'default' : 'outline'}
                aria-pressed={entry.id === preset}
                onClick={() => setPreset(entry.id)}
              >
                {entry.label}
              </Button>
            ))}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              id={`${id}-channel`}
              label="Send to"
              value={target}
              onChange={(event) => setChannelId(event.target.value)}
              options={channels.map((channel) => ({ value: channel.id, label: channel.name }))}
            />
            {chosen?.cadence === 'custom' ? (
              <Input
                id={`${id}-cron`}
                label="Cron (minute hour day month weekday)"
                value={cronExpr}
                required
                onChange={(event) => setCronExpr(event.target.value)}
              />
            ) : (
              <Input
                id={`${id}-time`}
                label="At"
                type="time"
                value={time}
                required
                onChange={(event) => setTime(event.target.value)}
              />
            )}
            <Input
              id={`${id}-timezone`}
              label="Timezone"
              value={timezone}
              required
              onChange={(event) => setTimezone(event.target.value)}
            />
          </div>
          <div>
            <Button type="submit" className="min-h-10">
              Schedule
            </Button>
          </div>
        </form>
      )}
      {subscriptions.status === 'loading' ? (
        <Skeleton className="h-10 w-full" />
      ) : subscriptions.status === 'error' ? (
        <Quiet role="alert">{subscriptions.message}</Quiet>
      ) : subscriptions.value.length === 0 ? (
        <Quiet>Nothing scheduled.</Quiet>
      ) : (
        <ul className="divide-y divide-border" aria-label="Scheduled reports">
          {subscriptions.value.map((subscription) => (
            <li key={subscription.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium">{subscription.describe}</span>{' '}
                <span className="text-xs text-fg-muted">
                  to {nameOf(subscription.channelId)} · {subscription.timezone}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => remove(subscription.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_VARIANT: Record<
  DeliverySummary['status'],
  'outline' | 'secondary' | 'success' | 'danger'
> = {
  pending: 'outline',
  sending: 'outline',
  sent: 'success',
  failed: 'danger',
};

function History({ deliveries }: { deliveries: DeliverySummary[] }): React.ReactElement {
  const [open, setOpen] = React.useState<string | null>(null);
  if (deliveries.length === 0) return <Quiet>No report has been sent yet.</Quiet>;
  return (
    <Table aria-label="Delivery history">
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Detail</TableHead>
          <TableHead>
            <span className="sr-only">Report</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery) => (
          <React.Fragment key={delivery.id}>
            <TableRow data-testid={`delivery-${delivery.id}`}>
              <TableCell className="text-xs text-fg-muted">
                {ago(delivery.sentAt ?? delivery.scheduledFor)}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[delivery.status]}>{delivery.status}</Badge>
              </TableCell>
              <TableCell className="hidden font-mono text-xs sm:table-cell">
                {delivery.errorCode ?? ''}
              </TableCell>
              <TableCell>
                {delivery.rendered === null ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open === delivery.id}
                    onClick={() => setOpen(open === delivery.id ? null : delivery.id)}
                  >
                    {open === delivery.id ? 'Hide' : 'Read'}
                  </Button>
                )}
              </TableCell>
            </TableRow>
            {open === delivery.id && delivery.rendered !== null ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{delivery.rendered}</pre>
                </TableCell>
              </TableRow>
            ) : null}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export function NotificationsPage({ client }: { client: NotificationsClient }): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const changed = React.useCallback(() => setVersion((value) => value + 1), []);
  const channels = useResource(() => client.listChannels(), [client, version]);
  const deliveries = useResource(() => client.listDeliveries(), [client, version]);
  const preview = useResource(() => client.preview('weekly'), [client, version]);
  return (
    <PageFrame data-testid="notifications-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Reports"
        subtitle="Daily, weekly or on your schedule — to your inbox or chat."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="1 · Where">
          {channels.status === 'loading' ? (
            <Skeleton className="h-24 w-full" />
          ) : channels.status === 'error' ? (
            <Quiet role="alert">{channels.message}</Quiet>
          ) : (
            <div className="grid gap-4">
              <Channels client={client} channels={channels.value} onChanged={changed} />
              <AddChannel client={client} onAdded={changed} />
            </div>
          )}
        </Panel>
        <Panel title="2 · When">
          {channels.status === 'ready' ? (
            <Schedules
              client={client}
              channels={channels.value}
              onChanged={changed}
              version={version}
            />
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </Panel>
        <Panel title="This week's report, as it would arrive">
          {preview.status === 'ready' ? (
            <pre data-testid="report-preview" className="whitespace-pre-wrap font-sans text-sm">
              {preview.value.text}
            </pre>
          ) : preview.status === 'error' ? (
            <Quiet role="alert">{preview.message}</Quiet>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </Panel>
        <Panel title="3 · Did it arrive">
          {deliveries.status === 'ready' ? (
            <History deliveries={deliveries.value} />
          ) : deliveries.status === 'error' ? (
            <Quiet role="alert">{deliveries.message}</Quiet>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </Panel>
      </div>
    </PageFrame>
  );
}
