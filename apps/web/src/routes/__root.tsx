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
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <NavBar />
          <div style={{ display: 'flex', flex: 1 }}>
            <Sidebar />
            <main style={{ flex: 1, padding: '16px', overflow: 'auto' }}>
              <Outlet />
            </main>
          </div>
        </div>
        <GlobalCommandPalette />
      </AuthGuard>
    </ThemeProvider>
  );
}
