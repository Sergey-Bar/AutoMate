import { Link, Outlet } from '@tanstack/react-router';
import { ThemeToggle } from './ThemeToggle.js';
import { ConnectedConversationSidebar } from '../chat/conversation-sidebar.js';
import { ErrorBoundary } from '../shared/ErrorBoundary.js';
import { useEmbeddedMode } from '../../hooks/useEmbeddedMode.js';
import { useShellSync } from '../../hooks/useShellSync.js';

export function AppLayout() {
  const isEmbedded = useEmbeddedMode();
  useShellSync(isEmbedded);

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950">
      {!isEmbedded && (
        <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
          <div className="p-4 font-bold text-lg">Automate</div>
          <ConnectedConversationSidebar />
          <nav className="mt-auto p-4 space-y-2 border-t border-zinc-200 dark:border-zinc-800">
            <Link to="/settings/connectors" className="block text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Connectors</Link>
            <Link to="/settings/model" className="block text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Model</Link>
            <Link to="/settings/vault" className="block text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Vault</Link>
            <Link to="/sql" className="block text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">SQL Browser</Link>
          </nav>
          <div className="p-4"><ThemeToggle /></div>
        </aside>
      )}
      <main className="flex-1 overflow-auto">
        <ErrorBoundary label="Page">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}