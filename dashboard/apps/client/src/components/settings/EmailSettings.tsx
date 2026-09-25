import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Send as SendIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection, SettingRow } from './SettingsSection';

export function EmailSettings() {
  const qc = useQueryClient();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [recipients, setRecipients] = useState('');
  const [enabled, setEnabled] = useState(true);

  const { data: config } = useQuery<Record<string, Record<string, unknown>>>({
    queryKey: ['integrations-config'],
    queryFn: () => fetch('/api/integrations/config').then((r) => r.json()),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (config?.email) {
      setHost((config.email.host as string) ?? '');
      setPort(String(config.email.port ?? 587));
      setSecure((config.email.secure as boolean) ?? false);
      setUser((config.email.user as string) ?? '');
      setRecipients(((config.email.recipients as string[]) ?? []).join(', '));
      setEnabled((config.email.enabled as boolean) ?? true);
    }
  }, [config?.email]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/integrations/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: {
            host: host || undefined,
            port: Number(port) || 587,
            secure,
            user: user || undefined,
            pass: pass || undefined,
            recipients: recipients.split(',').map((r) => r.trim()).filter(Boolean),
            enabled,
          },
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations-config'] });
      toast.success('Email config saved');
    },
    onError: () => toast.error('Failed to save email config'),
  });

  const testEmail = useMutation({
    mutationFn: () =>
      fetch('/api/integrations/test/email', { method: 'POST' }).then((r) => {
        if (!r.ok) throw new Error('Test failed');
        return r.json();
      }),
    onSuccess: () => toast.success('Test email sent'),
    onError: () => toast.error('Email test failed — check SMTP settings'),
  });

  return (
    <SettingsSection title="Email Reports">
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={14} className="text-accent" />
          <p className="text-sm font-medium text-text-primary">SMTP Configuration</p>
        </div>
        <p className="text-[11px] mb-3 text-text-tertiary">
          Sends run summary email to recipients on completion
        </p>
      </div>

      <SettingRow label="SMTP Host" description="Mail server hostname (e.g. smtp.gmail.com)">
        <Input size="sm" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" className="font-mono" style={{ width: '12rem' }} />
      </SettingRow>

      <SettingRow label="Port" description="SMTP port (587 for TLS, 465 for SSL)">
        <Input size="sm" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" style={{ width: '6rem' }} />
      </SettingRow>

      <SettingRow label="Secure" description="Use SSL/TLS connection">
        <Toggle checked={secure} onChange={setSecure} />
      </SettingRow>

      <SettingRow label="Username" description="SMTP auth username / email">
        <Input size="sm" value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" className="font-mono" style={{ width: '12rem' }} />
      </SettingRow>

      <SettingRow label="Password" description="SMTP auth password or app password">
        <Input size="sm" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={(config?.email?.pass as string) ?? '••••••••'} className="font-mono" style={{ width: '12rem' }} />
      </SettingRow>

      <SettingRow label="Recipients" description="Comma-separated email addresses">
        <Input size="sm" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="qa@company.com, dev@company.com" className="font-mono" style={{ width: '16rem' }} />
      </SettingRow>

      <SettingRow label="Enabled" description="Send emails on run completion">
        <Toggle checked={enabled} onChange={setEnabled} />
      </SettingRow>

      <div className="flex items-center gap-2 px-4 py-3">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" size="sm" icon={<SendIcon size={11} />} loading={testEmail.isPending} onClick={() => testEmail.mutate()}>
          {testEmail.isPending ? 'Sending…' : 'Send Test'}
        </Button>
      </div>
    </SettingsSection>
  );
}
