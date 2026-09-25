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
        <div className="app-shell">
          <NavBar />
          <div className="app-body">
            <Sidebar />
            <main className="app-main">
              <div className="app-main-inner">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
        <GlobalCommandPalette />
      </AuthGuard>
    </ThemeProvider>
  );
}
