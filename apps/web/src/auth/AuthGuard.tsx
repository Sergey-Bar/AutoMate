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

  if (isChecking && !isLoginPage) return <div data-testid="auth-loading">Loading</div>;
  if (!isAuthenticated && !isLoginPage) return null;
  return <>{children}</>;
}
