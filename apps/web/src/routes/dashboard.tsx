import React from 'react';
import { createRoute, Outlet, Link, useRouterState } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';
import { RunList } from '../components/RunList.js';
import { AuthGuard } from '../auth/AuthGuard.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardComponent,
});

function DashboardComponent() {
  const routerState = useRouterState();
  const isExactDashboard = routerState.location.pathname === '/dashboard';

  return (
    <AuthGuard>
    <div data-testid="dashboard-page" className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <nav className="flex space-x-4">
          <Link
            to="/dashboard"
            className="text-text-secondary hover:text-text-primary [&.active]:text-blue-500 [&.active]:font-medium"
          >
            Runs
          </Link>
          <Link
            to="/dashboard/analytics"
            className="text-text-secondary hover:text-text-primary [&.active]:text-blue-500 [&.active]:font-medium"
          >
            Analytics
          </Link>
          <Link
            to="/dashboard/quarantine"
            className="text-text-secondary hover:text-text-primary [&.active]:text-blue-500 [&.active]:font-medium"
          >
            Quarantine
          </Link>
        </nav>
      </div>
      
      {isExactDashboard ? <RunList /> : <Outlet />}
    </div>
    </AuthGuard>
  );
}

