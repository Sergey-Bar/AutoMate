import React from 'react';
import { createRoute, Link } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexComponent,
});

function IndexComponent() {
  const sections = [
    {
      title: 'Dashboard',
      description: 'Run monitoring, analytics, quarantine, and quality insights.',
      href: '/dashboard',
      cta: 'Open Dashboard',
    },
    {
      title: 'AI Workspace',
      description: 'Conversations, model settings, and assisted QA workflows.',
      href: '/ai',
      cta: 'Open AI',
    },
    {
      title: 'Tools',
      description: 'Operational status of QA domains and next implementation steps.',
      href: '/tools',
      cta: 'Open Tools',
    },
    {
      title: 'Integrations',
      description: 'Connector catalog and credential-vault linked health state.',
      href: '/integrations',
      cta: 'Open Integrations',
    },
  ];

  return (
    <div data-testid="home-page" className="space-y-8 p-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold">Automate Unified Platform</h1>
        <p className="mt-3 max-w-3xl text-gray-600">
          Central workspace for test intelligence, QA orchestration, and product quality gates.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/dashboard"
            className="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
          >
            Go To Dashboard
          </Link>
          <Link
            to="/settings"
            className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 transition hover:bg-gray-50"
          >
            Open Settings
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((item) => (
          <article key={item.href} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm text-gray-600">{item.description}</p>
            <Link
              to={item.href}
              className="mt-4 inline-block rounded-md border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50"
            >
              {item.cta}
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
