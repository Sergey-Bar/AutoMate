import React from 'react';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { NavBar } from '../components/NavBar.js';
import { Sidebar } from '../components/Sidebar.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { GlobalCommandPalette } from '../components/GlobalCommandPalette.js';
import { AuthGuard } from '../auth/AuthGuard.js';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <AuthGuard>
        <div className="flex min-h-screen flex-col bg-surface text-fg">
          <NavBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
              <Outlet />
            </main>
          </div>
        </div>
        <GlobalCommandPalette />
      </AuthGuard>
    </ThemeProvider>
  );
}
