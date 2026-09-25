import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore, type Workspace } from '@/store/workspaceStore';
import { ChevronDown, FolderOpen, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  collapsed: boolean;
}

export function WorkspaceSwitcher({ collapsed }: Props) {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: workspaces } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => fetch('/api/workspaces').then((r) => r.json()),
    staleTime: 30_000,
  });

  const active = workspaces?.find((w) => w.id === activeWorkspaceId);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!workspaces?.length) return null;

  return (
    <div ref={ref} className="relative px-2 mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-1.5 rounded-lg text-xs transition-colors hover:bg-white/5 text-text-secondary"
        title={collapsed ? (active?.name ?? 'All workspaces') : undefined}
      >
        <FolderOpen size={14} className="shrink-0 text-text-tertiary" />
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left text-text-primary">
              {active?.name ?? 'All workspaces'}
            </span>
            <ChevronDown size={12} className="text-text-tertiary" />
          </>
        )}
      </button>

      {open && (
        <div
          className="absolute left-2 right-2 top-full mt-1 z-50 rounded-lg border border-border-default py-1 shadow-xl bg-bg-elevated"
        >
          {/* All option */}
          <button
            onClick={() => { setActiveWorkspaceId(null); queryClient.invalidateQueries(); setOpen(false); }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-white/5',
              !activeWorkspaceId ? 'text-text-primary font-semibold' : 'text-text-secondary font-normal',
            )}
          >
            All workspaces
          </button>

          <div className="h-px my-1 bg-border-subtle" />

          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => { setActiveWorkspaceId(ws.id); queryClient.invalidateQueries(); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-white/5 truncate',
                activeWorkspaceId === ws.id ? 'text-text-primary font-semibold' : 'text-text-secondary font-normal',
              )}
            >
              {ws.name}
            </button>
          ))}

          <div className="h-px my-1 bg-border-subtle" />

          <a
            href="/settings"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 text-text-tertiary"
          >
            <Plus size={11} /> Add workspace
          </a>
        </div>
      )}
    </div>
  );
}
