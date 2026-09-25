import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { PageTransition } from './PageTransition';
import { NotificationCenter } from './NotificationCenter';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { useWsStore } from '@/store/wsStore';
import { useFeatureStore } from '@/store/featureStore';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

import { useEmbeddedMode } from '@/hooks/useEmbeddedMode';
import { useShellSync } from '@/hooks/useShellSync';

const CommandPalette = lazy(() => import('./CommandPalette').then(m => ({ default: m.CommandPalette })));
const OnboardingWizard = lazy(() => import('../onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const ShortcutsModal = lazy(() => import('../shared/ShortcutsModal').then(m => ({ default: m.ShortcutsModal })));

const SIDEBAR_WIDTH = 240;
const SIDEBAR_ICON_WIDTH = 48;
const BP_ICON_RAIL = 1400;
const BP_TOO_SMALL = 640;

function useViewportWidth() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const vw = useViewportWidth();
  const autoCollapsed = vw < BP_ICON_RAIL;
  const tooSmall = vw < BP_TOO_SMALL;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(autoCollapsed);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [viewportDismissed, setViewportDismissed] = useState(() => {
    try { return sessionStorage.getItem('mc-vp-dismissed') === '1'; } catch { return false; }
  });
  const navigate = useNavigate();
  const connectionState = useWsStore((s) => s.connectionState);
  const commandPaletteEnabled = useFeatureStore((s) => s.flags['command-palette'] ?? false);
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const isEmbedded = useEmbeddedMode();
  useShellSync(isEmbedded);

  // Fetch feature flags once on app load
  const fetchFlags = useFeatureStore((s) => s.fetchFlags);
  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  // G-prefix navigation state
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-collapse when viewport shrinks below breakpoint
  useEffect(() => {
    if (autoCollapsed) setSidebarCollapsed(true);
  }, [autoCollapsed]);

  // Keyboard shortcuts
  useEffect(() => {
    const G_MAP: Record<string, string> = {
      d: '/',
      r: '/runs',
      t: '/tests',
      a: '/analytics',
      s: '/settings',
      b: '/baselines',
      c: '/config',
    };

    function onKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;

      // [ = toggle sidebar
      if (e.key === '[' && !e.metaKey && !e.ctrlKey) {
        setSidebarCollapsed((v) => !v);
        return;
      }
      // Cmd/Ctrl+K = command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (commandPaletteEnabled) setCommandOpen((v) => !v);
        return;
      }
      // ? = shortcuts modal
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        setShortcutsOpen((v) => !v);
        return;
      }
      // G-prefix navigation
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!pendingG.current) {
          pendingG.current = true;
          clearTimeout(gTimer.current);
          gTimer.current = setTimeout(() => { pendingG.current = false; }, 500);
          return;
        }
      }
      if (pendingG.current) {
        pendingG.current = false;
        clearTimeout(gTimer.current);
        const route = G_MAP[e.key];
        if (route) {
          e.preventDefault();
          navigate({ to: route });
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(gTimer.current);
    };
  }, [commandPaletteEnabled, navigate]);

  const sidebarW = sidebarCollapsed ? SIDEBAR_ICON_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className={cn('flex h-dvh overflow-hidden', 'bg-bg-base')}>
      {/* Viewport too narrow notice */}
      {tooSmall && !viewportDismissed && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className={cn('fixed bottom-4 left-4 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl border shadow-lg text-xs', 'bg-bg-elevated border-border-default text-text-secondary')}
        >
          <span>{tr('layout.bestViewed', 'Best viewed at 640px+')}</span>
          <button
            type="button"
            onClick={() => { setViewportDismissed(true); try { sessionStorage.setItem('mc-vp-dismissed', '1'); } catch (_) { /* sessionStorage unavailable */ } }}
            className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors', 'text-text-tertiary')}
            aria-label={tr('layout.dismissViewportWarning', 'Dismiss viewport warning')}
          >
            {tr('layout.dismiss', 'Dismiss')}
          </button>
        </motion.div>
      )}

      {/* Sidebar */}
      {!isEmbedded && (
        <motion.aside
          animate={{ width: sidebarW }}
          transition={spring.smooth}
          className={cn('shrink-0 border-r overflow-hidden', 'border-border-subtle')}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((v) => !v)}
            connectionState={connectionState}
          />
        </motion.aside>
      )}

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        {!isEmbedded && <TopBar commandPaletteEnabled={commandPaletteEnabled} onCommandOpen={() => setCommandOpen(true)} />}

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <ErrorBoundary label="Page">
            <PageTransition routeKey={currentPath}>
              <Outlet />
            </PageTransition>
          </ErrorBoundary>
        </main>

        {/* Live region for screen reader announcements */}
        <div aria-live="polite" aria-atomic="true" className="sr-only" />

        {/* Footer */}
        <footer className={cn('shrink-0 flex justify-end px-4 py-1.5 text-[10px] tracking-wider', 'text-text-tertiary')}>
          baked with love by{' '}
          <a
            href="https://www.linkedin.com/in/sergeybar/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn('ml-1 underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity', 'text-text-secondary')}
          >
            Sergey Bar
          </a>
        </footer>
      </div>

      {/* Command palette */}
      <AnimatePresence>
        {commandPaletteEnabled && commandOpen && (
          <ErrorBoundary label="Command Palette">
            <Suspense fallback={null}>
              <CommandPalette onClose={() => setCommandOpen(false)} />
            </Suspense>
          </ErrorBoundary>
        )}
      </AnimatePresence>

      {/* Shortcuts modal */}
      <AnimatePresence>
        {shortcutsOpen && (
          <ErrorBoundary label="Shortcuts">
            <Suspense fallback={null}>
              <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
            </Suspense>
          </ErrorBoundary>
        )}
      </AnimatePresence>

      {/* Onboarding wizard */}
      <ErrorBoundary label="Onboarding">
        <Suspense fallback={null}>
          <OnboardingWizard />
        </Suspense>
      </ErrorBoundary>

      {/* Breadcrumb navigation (renders via portal into #breadcrumb-portal in TopBar) */}
      <Breadcrumbs />
    </div>
  );
}

function TopBar({ commandPaletteEnabled, onCommandOpen }: { commandPaletteEnabled: boolean; onCommandOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);

  return (
    <header
      className={cn('h-11 flex items-center justify-between px-4 border-b shrink-0', 'bg-bg-surface border-border-subtle')}
    >
      {/* Left: breadcrumbs rendered by active route via context */}
      <div id="breadcrumb-portal" className={cn('text-sm', 'text-text-secondary')} />

      {/* Right: theme toggle + command hint + user */}
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <LanguageSwitcher />
        <NotificationCenter />
        {commandPaletteEnabled && (
          <button
            type="button"
            onClick={onCommandOpen}
            className={cn('flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors', 'text-text-tertiary border-border-default')}
            aria-label={hasI18n ? t('layout.openCommandPalette', { defaultValue: 'Open command palette' }) : 'Open command palette'}
          >
            <span>⌘K</span>
          </button>
        )}
      </div>
    </header>
  );
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el as HTMLElement)?.contentEditable === 'true';
}

