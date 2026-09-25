import React, { useEffect, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Button } from '@automate/ui';
import { visibleRoutes } from '../route-manifest.js';

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const [isCollapsed, setIsCollapsed] = useState(() =>
    typeof window === 'undefined'
      ? false
      : localStorage.getItem('automate-sidebar-collapsed') === 'true',
  );

  useEffect(() => {
    localStorage.setItem('automate-sidebar-collapsed', String(isCollapsed));
  }, [isCollapsed]);

  const isActive = (path: string) =>
    path === '/dashboard' ? currentPath === path : currentPath.startsWith(path);

  return (
    <aside
      data-testid="sidebar"
      className={`flex shrink-0 flex-col border-r border-border-default bg-surface-muted transition-[width] ${isCollapsed ? 'w-16' : 'w-56'}`}
    >
      <div className="border-b border-border-default p-3">
        <Button
          variant="outline"
          onClick={() => setIsCollapsed((value) => !value)}
          data-testid="sidebar-toggle"
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="w-full"
        >
          {isCollapsed ? '›' : 'Collapse'}
        </Button>
      </div>
      <nav className="flex flex-col gap-1 p-2" aria-label="Primary navigation">
        {visibleRoutes.map((route) => (
          <Link
            key={route.id}
            to={route.path}
            title={route.label}
            aria-current={isActive(route.path) ? 'page' : undefined}
            className="rounded-md no-underline"
          >
            <Button
              variant={isActive(route.path) ? 'secondary' : 'ghost'}
              className="w-full justify-start"
            >
              {isCollapsed ? route.label.charAt(0) : route.label}
            </Button>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
