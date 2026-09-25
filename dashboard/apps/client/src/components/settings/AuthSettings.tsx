import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Trash2, Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SettingsSection } from './SettingsSection';

interface AuthStatus {
  enabled: boolean;
  keyCount: number;
}

interface ApiKeyPreview {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface GeneratedKey extends ApiKeyPreview {
  key: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AuthSettings() {
  const qc = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<GeneratedKey | null>(null);

  const { data: status } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => fetch('/api/auth/status').then((r) => r.json()),
  });

  const { data: keys = [] } = useQuery<ApiKeyPreview[]>({
    queryKey: ['auth-keys'],
    queryFn: () => fetch('/api/auth/keys').then((r) => r.json()),
  });

  const toggleAuth = useMutation({
    mutationFn: (enabled: boolean) =>
      fetch('/api/auth/enable', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-status'] });
      toast.success(status?.enabled ? 'Authentication disabled' : 'Authentication enabled');
    },
    onError: () => toast.error('Failed to update authentication'),
  });

  const generateKey = useMutation({
    mutationFn: (name: string) =>
      fetch('/api/auth/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to generate key');
        return r.json() as Promise<GeneratedKey>;
      }),
    onSuccess: (data) => {
      setGeneratedKey(data);
      setNewKeyName('');
      qc.invalidateQueries({ queryKey: ['auth-keys'] });
      qc.invalidateQueries({ queryKey: ['auth-status'] });
      toast.success('API key generated');
    },
    onError: () => toast.error('Failed to generate API key'),
  });

  const deleteKey = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/auth/keys/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error('Failed to delete key');
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-keys'] });
      qc.invalidateQueries({ queryKey: ['auth-status'] });
      toast.success('API key revoked');
    },
    onError: () => toast.error('Failed to revoke API key'),
  });

  function handleCopyKey() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey.key);
    toast.success('API key copied to clipboard');
  }

  const isEnabled = status?.enabled ?? false;

  return (
    <div className="space-y-4">
      {/* Auth Status */}
      <SettingsSection title="Authentication">
        {!isEnabled && (
          <div className="flex items-start gap-2 px-4 py-3 border-b border-border-subtle bg-amber-500/10">
            <ShieldAlert size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p className="text-xs text-amber-600">
              API is publicly accessible. Enable authentication to secure your instance.
            </p>
          </div>
        )}
        {isEnabled && (
          <div className="flex items-start gap-2 px-4 py-3 border-b border-border-subtle bg-emerald-500/10">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-emerald-500" />
            <p className="text-xs text-emerald-600">
              Authentication is active. All API requests require a valid bearer token.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {isEnabled ? 'Enabled' : 'Disabled'}
            </p>
            <p className="text-xs text-text-tertiary">
              {status?.keyCount ?? 0} API key{(status?.keyCount ?? 0) !== 1 ? 's' : ''} configured
            </p>
          </div>
          <Button
            size="sm"
            variant={isEnabled ? 'danger' : 'primary'}
            loading={toggleAuth.isPending}
            onClick={() => toggleAuth.mutate(!isEnabled)}
          >
            {isEnabled ? 'Disable Auth' : 'Enable Auth'}
          </Button>
        </div>
      </SettingsSection>

      {/* API Keys */}
      <SettingsSection title="API Keys">
        {/* Generate new key */}
        <div className="px-4 py-3 border-b border-border-subtle">
          <p className="text-sm font-medium mb-2 text-text-primary">Generate New Key</p>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. CI Pipeline)"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newKeyName.trim()) generateKey.mutate(newKeyName.trim());
              }}
            />
            <Button
              size="sm"
              icon={<Plus size={11} />}
              loading={generateKey.isPending}
              disabled={!newKeyName.trim()}
              onClick={() => generateKey.mutate(newKeyName.trim())}
            >
              Generate
            </Button>
          </div>
        </div>

        {/* Newly generated key display */}
        {generatedKey && (
          <div className="px-4 py-3 border-b border-border-subtle bg-emerald-500/5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-emerald-600">New API Key — {generatedKey.name}</p>
              <Button size="sm" variant="ghost" icon={<Copy size={11} />} onClick={handleCopyKey}>
                Copy
              </Button>
            </div>
            <code className="block w-full font-mono text-xs text-text-primary bg-bg-elevated px-3 py-2 rounded-md border border-border-subtle break-all select-all">
              {generatedKey.key}
            </code>
            <p className="text-[11px] text-amber-600 mt-1.5">
              Copy this key now. It won't be shown again.
            </p>
          </div>
        )}

        {/* Existing keys list */}
        {keys.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-text-tertiary">No API keys configured. Generate one to get started.</p>
          </div>
        )}

        {keys.map((apiKey) => (
          <div
            key={apiKey.id}
            className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{apiKey.name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <code className="font-mono text-[11px] text-text-tertiary">{apiKey.keyPreview}</code>
                <span className="text-[11px] text-text-tertiary">
                  Created {formatDate(apiKey.createdAt)}
                </span>
                {apiKey.lastUsedAt && (
                  <span className="text-[11px] text-text-tertiary">
                    Last used {formatDate(apiKey.lastUsedAt)}
                  </span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={12} className="text-fail" />}
              loading={deleteKey.isPending}
              onClick={() => deleteKey.mutate(apiKey.id)}
            />
          </div>
        ))}
      </SettingsSection>
    </div>
  );
}
