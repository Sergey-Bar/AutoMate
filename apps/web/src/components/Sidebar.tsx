import React, { useState, useEffect } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Button } from '@automate/ui';

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('automate-sidebar-collapsed') === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('automate-sidebar-collapsed', String(isCollapsed));
    }
  }, [isCollapsed]);

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);

  let links: { to: string; label: string }[] = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/dashboard/analytics', label: 'Analytics' },
    { to: '/dashboard/quarantine', label: 'Quarantine' },
  ];
  if (currentPath.startsWith('/dashboard')) {
    links = [
      { to: '/dashboard', label: 'Overview' },
      { to: '/dashboard/analytics', label: 'Analytics' },
      { to: '/dashboard/quarantine', label: 'Quarantine' },
    ];
  }

  return (
    <aside
      data-testid="sidebar"
      style={{
        width: isCollapsed ? '60px' : '200px',
        borderRight: '1px solid #ccc',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s',
      }}
    >
      <div style={{ padding: '16px', borderBottom: '1px solid #ccc' }}>
        <Button variant="outline" onClick={toggleSidebar} data-testid="sidebar-toggle">
          {isCollapsed ? '►' : 'Collapse'}
        </Button>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' }}>
        {links.map((link) => (
          <Link key={link.to} to={link.to} style={{ textDecoration: 'none' }}>
            <Button
              variant={currentPath.startsWith(link.to) ? 'default' : 'ghost'}
              style={{ width: '100%', justifyContent: isCollapsed ? 'center' : 'flex-start' }}
            >
              {isCollapsed ? link.label.charAt(0) : link.label}
            </Button>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
