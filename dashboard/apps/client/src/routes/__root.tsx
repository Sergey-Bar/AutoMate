import { createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { NotFoundPage } from '@/components/shared/NotFoundPage';
import { useAuthStore } from '@/store/authStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';

export interface RouterContext {
  queryClient: QueryClient;
}

function RootComponent() {
  useEffect(() => {
    void useAuthStore.getState().checkAuthStatus();
  }, []);

  return (
    <ProtectedRoute>
      <AppShell />
    </ProtectedRoute>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});
