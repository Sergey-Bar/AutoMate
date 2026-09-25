import type { ReactNode } from 'react';
import { useUserRole } from '@/store/authStore';

interface RoleGateProps {
  allowedRoles: ('admin' | 'editor' | 'viewer')[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ allowedRoles, children, fallback = null }: RoleGateProps) {
  const role = useUserRole();

  if (allowedRoles.includes(role as 'admin' | 'editor' | 'viewer')) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
