import React, { useEffect, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Button, GLASS_SURFACE_CLASSES, PanelLeftClose, PanelLeftOpen, Home } from '@automate/ui';
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
      className={`flex shrink-0 flex-col border-r border-border-default transition-[width] ${GLASS_SURFACE_CLASSES} ${isCollapsed ? 'w-16' : 'w-56'}`}
    >
      <div className="border-b border-border-default p-3">
        <Link
          to="/dashboard"
          className="flex min-h-11 items-center rounded-md no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          aria-current={currentPath === '/dashboard' ? 'page' : undefined}
        >
          <Button variant="secondary" className="w-full justify-start">
            {isCollapsed ? (
              <Home size={16} aria-hidden="true" />
            ) : (
              <>
                <Home size={16} aria-hidden="true" className="mr-2" />
                MAIN
              </>
            )}
          </Button>
        </Link>
      </div>
      <div className="border-b border-border-default p-3">
        <Button
          variant="outline"
          onClick={() => setIsCollapsed((value) => !value)}
          data-testid="sidebar-toggle"
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="w-full"
        >
          {isCollapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose size={16} aria-hidden="true" />
              Collapse
            </>
          )}
        </Button>
      </div>
      <nav className="flex flex-col gap-1 p-2" aria-label="Primary navigation">
        {visibleRoutes.map((route) => (
          <Link
            key={route.id}
            to={route.path}
            title={route.label}
            aria-current={isActive(route.path) ? 'page' : undefined}
            className="flex min-h-11 items-center rounded-md no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
