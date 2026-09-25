import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useA11yAudit } from '../../hooks/useA11yAudit.js';
import { A11yViolationCard } from '../../components/dashboard/A11yViolationCard.js';
import { StatCard, EmptyState } from '@automate/ui';
import type { ApiClient, A11ySeverity, A11yViolation } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/accessibility',
  component: () => <AccessibilityPage />,
});

const SEVERITY_ORDER: A11ySeverity[] = ['critical', 'serious', 'moderate', 'minor'];

function groupBySeverity(violations: A11yViolation[]): Record<A11ySeverity, A11yViolation[]> {
  return {
    critical: violations.filter(v => v.severity === 'critical'),
    serious: violations.filter(v => v.severity === 'serious'),
    moderate: violations.filter(v => v.severity === 'moderate'),
    minor: violations.filter(v => v.severity === 'minor'),
  };
}

export function AccessibilityPage({ api }: { api?: ApiClient }) {
  const { data, isLoading, error, refetch } = useA11yAudit(api);

  if (isLoading) {
    return (
      <div data-testid="a11y-loading" className="p-8">
        Loading audit results…
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        data-testid="a11y-error"
        title="Error Loading Audit"
        description={error.message}
        action={
          <button type="button" onClick={refetch} className="mt-2">
            Retry
          </button>
        }
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        data-testid="a11y-empty"
        title="No Audit Data"
        description="No audit data available."
      />
    );
  }

  const grouped = groupBySeverity(data.violations);
  const criticalCount = grouped.critical.length;
  const totalViolations = data.violations.length;

  return (
    <main data-testid="a11y-page" className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Accessibility Audit</h1>

      <section
        data-testid="summary-stats"
        aria-label="Summary statistics"
        className="grid grid-cols-3 gap-4 mb-8"
      >
        <StatCard
          data-testid="stat-total-violations"
          title="Total Violations"
          value={totalViolations}
        />
        <StatCard
          data-testid="stat-critical-count"
          title="Critical"
          value={criticalCount}
        />
        <StatCard
          data-testid="stat-pages-scanned"
          title="Pages Scanned"
          value={data.pagesScanned}
        />
      </section>

      {totalViolations === 0 ? (
        <p data-testid="no-violations" className="text-fg-muted">
          No violations found. Great job!
        </p>
      ) : (
        <div data-testid="violations-list">
          {SEVERITY_ORDER.map(severity => {
            const items = grouped[severity];
            if (items.length === 0) return null;
            return (
              <section
                key={severity}
                data-testid={`severity-group-${severity}`}
                aria-label={`${severity} violations`}
                className="mb-6"
              >
                <h2 className="text-lg font-bold capitalize mb-3">
                  {severity} ({items.length})
                </h2>
                {items.map(v => (
                  <A11yViolationCard key={v.id} violation={v} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default AccessibilityPage;
