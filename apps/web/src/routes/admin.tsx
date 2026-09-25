import React from 'react';
import { createRoute, Link } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminComponent,
});

function AdminComponent() {
  const checks = [
    {
      name: 'Build Gate',
      desc: 'Ensure turbo build pipeline stays green for API, Web, and packages.',
      link: '/dashboard',
      linkLabel: 'Open Runs',
    },
    {
      name: 'Quality Gate',
      desc: 'Track pass-rate trends and quarantine management before release.',
      link: '/dashboard/quarantine',
      linkLabel: 'Open Quarantine',
    },
    {
      name: 'Configuration Integrity',
      desc: 'Model and connector settings must be valid before enabling features.',
      link: '/settings',
      linkLabel: 'Open Settings',
    },
  ];

  return (
    <div data-testid="admin-page" className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Admin Console</h1>
        <p className="mt-2 text-sm text-gray-600">
          Operational checklist for release readiness and platform governance.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {checks.map((check) => (
          <article key={check.name} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">{check.name}</h2>
            <p className="mt-2 text-sm text-gray-600">{check.desc}</p>
            <Link
              to={check.link}
              className="mt-4 inline-block rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {check.linkLabel}
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
