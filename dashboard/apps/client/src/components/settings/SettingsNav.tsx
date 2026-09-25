import {
  Server,
  Monitor,
  Clock,
  Link2,
  Webhook,
  Mail,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  FolderOpen,
  Tags,
  GitPullRequest,
  KeyRound,
  Database,
  HardDrive,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SettingsTab =
  | 'general'
  | 'auth'
  | 'data-retention'
  | 'backup'
  | 'display'
  | 'scheduler'
  | 'integrations'
  | 'webhooks'
  | 'email'
  | 'quality-gate'
  | 'quarantine'
  | 'ai'
  | 'workspaces'
  | 'categories'
  | 'pr-integration';

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: ReactNode;
  featureFlag?: string;
}

interface TabGroup {
  label: string;
  tabs: TabDef[];
}

const ICON_SIZE = 14;

const TAB_GROUPS: TabGroup[] = [
  {
    label: 'General',
    tabs: [
      { id: 'general', label: 'General', icon: <Server size={ICON_SIZE} /> },
      { id: 'auth', label: 'Authentication', icon: <KeyRound size={ICON_SIZE} /> },
      { id: 'data-retention', label: 'Data Retention', icon: <Database size={ICON_SIZE} /> },
      { id: 'backup', label: 'Backup & Restore', icon: <HardDrive size={ICON_SIZE} /> },
      { id: 'display', label: 'Display', icon: <Monitor size={ICON_SIZE} /> },
      { id: 'scheduler', label: 'Scheduler', icon: <Clock size={ICON_SIZE} />, featureFlag: 'scheduled-runs' },
    ],
  },
  {
    label: 'Integrations',
    tabs: [
      { id: 'integrations', label: 'Integrations', icon: <Link2 size={ICON_SIZE} />, featureFlag: 'integration-hooks' },
      { id: 'webhooks', label: 'Webhooks', icon: <Webhook size={ICON_SIZE} />, featureFlag: 'integration-hooks' },
      { id: 'email', label: 'Email', icon: <Mail size={ICON_SIZE} />, featureFlag: 'integration-hooks' },
      { id: 'pr-integration', label: 'PR Integration', icon: <GitPullRequest size={ICON_SIZE} />, featureFlag: 'pr-comparison' },
    ],
  },
  {
    label: 'Quality',
    tabs: [
      { id: 'quality-gate', label: 'Quality Gate', icon: <ShieldCheck size={ICON_SIZE} /> },
      { id: 'quarantine', label: 'Auto-Quarantine', icon: <ShieldAlert size={ICON_SIZE} />, featureFlag: 'auto-quarantine' },
      { id: 'ai', label: 'AI Config', icon: <Sparkles size={ICON_SIZE} />, featureFlag: 'ai-explain' },
    ],
  },
  {
    label: 'Organization',
    tabs: [
      { id: 'workspaces', label: 'Workspaces', icon: <FolderOpen size={ICON_SIZE} /> },
      { id: 'categories', label: 'Categories', icon: <Tags size={ICON_SIZE} /> },
    ],
  },
];

interface SettingsNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  flags?: Record<string, boolean>;
  flagsLoaded?: boolean;
}

export function SettingsNav({ activeTab, onTabChange, flags = {}, flagsLoaded = false }: SettingsNavProps) {
  return (
    <nav className="w-full md:w-48 shrink-0 space-y-4 pb-4 md:pb-0 md:pr-4 border-b md:border-b-0 md:border-r border-border-subtle">
      {TAB_GROUPS.map((group) => {
        const visibleTabs = group.tabs.filter((tab) => !tab.featureFlag || !flagsLoaded || flags[tab.featureFlag] !== false);
        if (visibleTabs.length === 0) return null;

        return (
        <div key={group.label}>
          <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors text-left',
                    isActive ? 'text-text-primary bg-[oklch(0.68_0.19_250_/_8%)]' : 'text-text-secondary bg-transparent',
                  )}
                >
                  <span className={cn('shrink-0', isActive ? 'text-running' : 'text-text-tertiary')}>
                    {tab.icon}
                  </span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      );
      })}
    </nav>
  );
}
