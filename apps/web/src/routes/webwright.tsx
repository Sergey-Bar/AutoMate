import React from 'react';
import { createRoute, Outlet } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';
import { AuthGuard } from '../auth/AuthGuard.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/webwright',
  component: WebwrightComponent,
});

function WebwrightComponent() {
  return (
    <AuthGuard>
      <div data-testid="webwright-page">
        <h1>Webwright</h1>
        <Outlet />
      </div>
    </AuthGuard>
  );
}
