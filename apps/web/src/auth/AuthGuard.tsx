import React from 'react';
import { useLocation, useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from './useAuth.js';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isChecking } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { location: routerLocation } = useRouterState();
  const isLoginPage = routerLocation.pathname === '/login';

  React.useEffect(() => {
    if (!isChecking && !isAuthenticated && !isLoginPage) {
      const returnPath = encodeURIComponent(location.pathname);
      void navigate({ to: '/login', search: { return: returnPath } });
    }
  }, [isAuthenticated, isChecking, isLoginPage, navigate, location.pathname]);

  /*
   * `role="status"` with an `aria-live` region, because this state change is
   * otherwise completely silent: a screen-reader user who triggers the guard gets
   * no announcement that the app is working, and none either that it has given
   * up and sent them to the login page. The visible text is unchanged.
   */
  if (isChecking && !isLoginPage) {
    return (
      <div role="status" aria-live="polite" data-testid="auth-loading">
        Loading
      </div>
    );
  }
  if (!isAuthenticated && !isLoginPage) return null;
  return <>{children}</>;
}
