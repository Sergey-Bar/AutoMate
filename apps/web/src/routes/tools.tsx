import React from 'react';
import { createRoute, Link } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tools',
  component: ToolsComponent,
});

function ToolsComponent() {
  const tools = [
    {
      name: 'Browser Agent',
      status: 'preview',
      details: 'Generates Playwright test template from prompt. Execution pipeline still pending.',
      action: '/ai',
      actionLabel: 'Open AI Workspace',
    },
    {
      name: 'API Agent',
      status: 'planned',
      details: 'Route contract exists but run implementation still returns not implemented.',
      action: '/dashboard',
      actionLabel: 'Track In Dashboard',
    },
    {
      name: 'Load Agent',
      status: 'planned',
      details: 'k6 orchestration contract is defined, runtime service not wired yet.',
      action: '/dashboard/analytics',
      actionLabel: 'View Analytics',
    },
    {
      name: 'Security Agent',
      status: 'planned',
      details: 'Security domain API contract ready; scanner execution and triage remain pending.',
      action: '/dashboard/accessibility',
      actionLabel: 'View A11y Section',
    },
  ];

  return (
    <div data-testid="tools-page" className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Tools And Domain Status</h1>
        <p className="mt-2 text-sm text-gray-600">
          Operational view of QA tool domains and implementation depth.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {tools.map((tool) => (
          <article key={tool.name} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tool.name}</h2>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium uppercase text-gray-700">
                {tool.status}
              </span>
            </div>
            <p className="mt-3 text-sm text-gray-600">{tool.details}</p>
            <Link
              to={tool.action}
              className="mt-4 inline-block rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {tool.actionLabel}
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
