import { Link, useRouterState } from '@tanstack/react-router';
import {
  LayoutDashboard,
  List,
  TestTube2,
  GitCompare,
  ShieldAlert,
  Layers,
  TrendingUp,
  Code2,
  Settings2,
  Settings,
  ChevronRight,
  Wifi,
  WifiOff,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { spring } from '@/lib/motion';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useTranslation } from 'react-i18next';
import { useWsStore } from '@/store/wsStore';
import { useFeatureStore } from '@/store/featureStore';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'offline';
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  to: string;
  badge?: string;
  featureFlag?: string;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
    ],
  },
  {
    label: 'RUNS',
    items: [
      { label: 'Runs',  icon: List, to: '/runs' },
    ],
  },
  {
    label: 'TESTING',
    items: [
      { label: 'Test Explorer', icon: TestTube2, to: '/tests' },
      { label: 'Compare',       icon: GitCompare, to: '/runs/compare', featureFlag: 'run-comparison' },
      { label: 'Baselines',     icon: Layers,     to: '/baselines', featureFlag: 'baseline-management' },
      { label: 'Quarantine',    icon: ShieldAlert, to: '/tests/quarantine', featureFlag: 'auto-quarantine' },
    ],
  },
  {
    label: 'ANALYTICS',
    items: [
      { label: 'Trends',    icon: TrendingUp, to: '/analytics' },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { label: 'Codegen',        icon: Code2,     to: '/tools/codegen',         featureFlag: 'codegen-launcher' },
      { label: 'Test Generator', icon: Wand2,     to: '/tools/test-generator',  featureFlag: 'test-generation' },
      { label: 'Config',         icon: Settings2, to: '/config',        featureFlag: 'codegen-launcher' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { label: 'Settings', icon: Settings, to: '/settings' },
    ],
  },
];

export function Sidebar({ collapsed, onToggle, connectionState }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const flags = useFeatureStore((s) => s.flags);
  const flagsLoaded = useFeatureStore((s) => s.loaded);

  return (
    <div
      className={cn('flex flex-col h-full overflow-hidden select-none', 'bg-bg-surface')}
    >
      {/* Logo */}
      <div className="flex items-center h-11 px-3 gap-2 shrink-0">
        <div
          className={cn('w-6 h-6 rounded flex items-center justify-center shrink-0 text-xs font-bold', 'bg-running')}
          style={{ color: '#fff' }}
        >
          A
        </div>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn('text-sm font-semibold truncate', 'text-text-primary')}
          >
            Automate
          </motion.span>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto p-1 rounded hover:bg-white/5 transition-colors"
          aria-label={tr('layout.toggleSidebar', 'Toggle sidebar')}
        >
          <motion.div animate={{ rotate: collapsed ? 0 : 180 }} transition={spring.smooth}>
            <ChevronRight size={14} className="text-text-tertiary" />
          </motion.div>
        </button>
      </div>

      {/* Workspace switcher */}
      <WorkspaceSwitcher collapsed={collapsed} />

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-2 px-2 space-y-4">
        {NAV.map((section) => (
          <div key={section.label ?? 'root'}>
            {section.label && !collapsed && (
              <p
                className={cn('px-2 mb-1 text-[11px] font-semibold tracking-[0.07em] uppercase', 'text-text-tertiary')}
              >
                {section.label}
              </p>
            )}
            {section.items.filter((item) => !item.featureFlag || !flagsLoaded || flags[item.featureFlag] !== false).map((item) => {
              const active = currentPath === item.to || (item.to !== '/' && currentPath.startsWith(item.to));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn('flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors w-full', active ? 'text-text-primary' : 'text-text-secondary')}
                  style={{
                    background: active ? 'oklch(0.68 0.19 250 / 8%)' : 'transparent',
                    borderLeft: active ? '2px solid var(--color-border-focus)' : '2px solid transparent',
                  }}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                >
                  <item.icon size={15} className="shrink-0" />
                {t(`nav.${item.label.toLowerCase().replace(/\s+/g, '')}`, item.label)}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Connection indicator */}
      <div
        className={cn('flex items-center gap-2 h-9 px-3 border-t shrink-0', 'border-border-subtle')}
        title={
          connectionState === 'connected'
            ? tr('connection.websocketConnected', 'WebSocket connected')
            : connectionState === 'reconnecting'
              ? tr('connection.attemptingReconnect', 'Attempting to reconnect...')
              : tr('connection.websocketDisconnected', 'WebSocket disconnected')
        }
      >
        <ConnectionDot state={connectionState} />
        {!collapsed && (
          <span className={cn('text-xs flex-1 truncate', 'text-text-tertiary')}>
            {connectionState === 'connected' && tr('connection.live', 'Live')}
            {connectionState === 'reconnecting' && tr('connection.reconnecting', 'Reconnecting…')}
            {connectionState === 'connecting' && tr('connection.connecting', 'Connecting…')}
            {connectionState === 'offline' && tr('connection.offline', 'Offline')}
          </span>
        )}
        {!collapsed && connectionState === 'offline' && (
          <button
            type="button"
            onClick={() => useWsStore.getState().connect()}
            className={cn('text-[10px] px-1.5 py-0.5 rounded transition-colors', 'text-text-secondary')}
            style={{
              background: 'oklch(0.5 0 0 / 10%)',
            }}
            aria-label={tr('connection.retryConnection', 'Retry connection')}
          >
            {tr('connection.retry', 'Retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectionDot({ state }: { state: SidebarProps['connectionState'] }) {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const colorClass =
    state === 'connected'    ? 'text-pass'
    : state === 'reconnecting' ? 'text-flaky'
    : 'text-fail';

  const icon =
    state === 'connected'    ? <Wifi size={12} />
    : state === 'reconnecting' ? <RefreshCw size={12} className="animate-spin" />
    : <WifiOff size={12} />;

  return (
    <span
      className={cn('shrink-0', state === 'connected' && 'animate-pulse', colorClass)}
      title={hasI18n ? t('connection.state', { defaultValue: 'Connection: {{state}}', state }) : `Connection: ${state}`}
    >
      {icon}
    </span>
  );
}
