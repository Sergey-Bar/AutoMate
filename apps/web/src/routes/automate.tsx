import React from 'react';
import { createRoute, Outlet } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';
import { AuthGuard } from '../auth/AuthGuard.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/automate',
  component: AutomateComponent,
});

function AutomateComponent() {
  return (
    <AuthGuard>
      <div data-testid="automate-page">
        <h1>Automate</h1>
        <Outlet />
      </div>
    </AuthGuard>
  );
}
