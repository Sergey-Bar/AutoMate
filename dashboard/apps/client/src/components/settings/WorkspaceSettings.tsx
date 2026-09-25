import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export function WorkspaceSettings() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [configPath, setConfigPath] = useState('');

  const { data: workspaces } = useQuery<Array<{ id: string; name: string; configPath: string; createdAt: string }>>({
    queryKey: ['workspaces'],
    queryFn: () => fetch('/api/workspaces').then((r) => r.json()),
    staleTime: 30_000,
  });

  const createWs = useMutation({
    mutationFn: () =>
      fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, configPath }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      setName('');
      setConfigPath('');
      toast.success('Workspace created');
    },
    onError: () => toast.error('Failed to create workspace'),
  });

  const deleteWs = useMutation({
    mutationFn: (id: string) => fetch(`/api/workspaces/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Workspace deleted');
    },
  });

  return (
    <div className="rounded-xl border border-border-default overflow-hidden">
      <div
        className="px-4 py-2.5 border-b border-border-subtle text-[11px] font-semibold uppercase tracking-wider flex items-center gap-2 bg-bg-surface text-text-tertiary"
      >
        <FolderOpen size={12} />
        Workspaces
      </div>
      <div className="bg-bg-surface">
        {workspaces?.map((ws) => (
          <div
            key={ws.id}
            className="flex items-center justify-between px-4 py-3 border-b border-border-subtle last:border-0"
          >
            <div>
              <p className="text-sm font-medium text-text-primary">{ws.name}</p>
              <p className="text-xs font-mono text-text-tertiary">{ws.configPath}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => deleteWs.mutate(ws.id)} aria-label="Delete workspace">
              <Trash2 size={13} className="text-fail" />
            </Button>
          </div>
        ))}

        <div className={cn('flex items-center gap-2 px-4 py-3 border-t border-border-subtle')}>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" />
          <Input size="sm" value={configPath} onChange={(e) => setConfigPath(e.target.value)} placeholder="playwright.config.ts path" className="flex-1 font-mono" />
          <Button size="sm" icon={<Plus size={13} />} onClick={() => name.trim() && configPath.trim() && createWs.mutate()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
