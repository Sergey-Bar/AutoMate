import React from 'react';
import { useNavigate, useLocation, useRouterState } from '@tanstack/react-router';
import { useAuth } from './useAuth.js';

interface AuthGuardProps {
  children: React.ReactNode;
}

function isAuthRequired(): boolean {
  const authRequired = import.meta.env['VITE_AUTH_REQUIRED'];
  if (typeof authRequired !== 'string') {
    return true;
  }
  return authRequired.toLowerCase() !== 'false';
}

export function AuthGuard({ children }: AuthGuardProps) {
  const authRequired = isAuthRequired();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { location: routerLocation } = useRouterState();

  const isLoginPage = routerLocation.pathname === '/login';

  React.useEffect(() => {
    if (authRequired && !isAuthenticated && !isLoginPage) {
      const returnPath = encodeURIComponent(location.pathname);
      void navigate({ to: '/login', search: { return: returnPath } });
    }
  }, [authRequired, isAuthenticated, isLoginPage, navigate, location.pathname]);

  if (authRequired && !isAuthenticated && !isLoginPage) {
    return null;
  }

  return <>{children}</>;
}
