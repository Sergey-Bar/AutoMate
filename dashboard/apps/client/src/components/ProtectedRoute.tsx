import { ReactNode, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/store/authStore';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const enabled = useAuthStore((s) => s.enabled);
  const authenticated = useAuthStore((s) => s.authenticated);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  useEffect(() => {
    if (!loading && enabled && !authenticated && pathname !== '/login') {
      navigate({ to: '/login' });
    }
  }, [loading, enabled, authenticated, pathname, navigate]);

  if (loading) {
    return (
      <div className="relative" data-testid="auth-loading">
        {children}
        <div className="absolute inset-0 flex items-center justify-center bg-bg-base/60">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-default border-t-running" />
        </div>
      </div>
    );
  }

  if (enabled && !authenticated && pathname !== '/login') {
    return null;
  }

  return <>{children}</>;
}
