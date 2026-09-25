import React, { useState, useEffect } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';

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

  let links: { to: string; label: string }[] = [];
  if (currentPath.startsWith('/dashboard')) {
    links = [
      { to: '/dashboard', label: 'Overview' },
      { to: '/dashboard/analytics', label: 'Analytics' },
      { to: '/dashboard/quarantine', label: 'Quarantine' },
      { to: '/ai', label: 'AI' },
      { to: '/tools', label: 'Tools' },
      { to: '/integrations', label: 'Integrations' },
    ];
  } else if (currentPath.startsWith('/automate')) {
    links = [
      { to: '/automate', label: 'Overview' },
    ];
  } else if (currentPath.startsWith('/webwright')) {
    links = [
      { to: '/webwright', label: 'Overview' },
    ];
  } else if (currentPath.startsWith('/settings')) {
    links = [
      { to: '/settings', label: 'Settings' },
      { to: '/admin', label: 'Admin' },
    ];
  } else {
    links = [
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/ai', label: 'AI' },
      { to: '/tools', label: 'Tools' },
      { to: '/integrations', label: 'Integrations' },
      { to: '/settings', label: 'Settings' },
      { to: '/admin', label: 'Admin' },
    ];
  }

  return (
    <aside
      data-testid="sidebar"
      className={isCollapsed ? 'app-sidebar app-sidebar-collapsed' : 'app-sidebar'}
    >
      <div className="sidebar-header">
        {!isCollapsed && <p className="sidebar-title">Workspace</p>}
        <button type="button" className="action-button" onClick={toggleSidebar} data-testid="sidebar-toggle">
          {isCollapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      <nav className="sidebar-nav">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={currentPath.startsWith(link.to) ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
          >
            {isCollapsed ? link.label.charAt(0) : link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
