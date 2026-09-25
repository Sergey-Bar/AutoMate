import React, { useEffect, useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';
import { defaultApiClient, type Connector } from '../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations',
  component: IntegrationsComponent,
});

function IntegrationsComponent() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchConnectors = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await defaultApiClient.getConnectors();
        if (mounted) {
          setConnectors(data);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void fetchConnectors();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div data-testid="integrations-page" className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="mt-2 text-sm text-gray-600">
          Connector status from the unified connector registry and vault wiring.
        </p>
      </header>

      {loading && <p className="text-sm text-gray-500">Loading connectors...</p>}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && connectors.length === 0 && (
        <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No connectors registered yet.
        </div>
      )}

      {!loading && !error && connectors.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {connectors.map((connector) => (
            <li key={`${connector.type}-${connector.name}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{connector.displayName}</h2>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs uppercase text-gray-700">
                  {connector.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">Type: {connector.type}</p>
              {connector.description && (
                <p className="mt-1 text-sm text-gray-500">{connector.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
