import React from 'react';
import { useA11yAudit } from '../../hooks/useA11yAudit.js';
import { A11yViolationCard } from '../../components/dashboard/A11yViolationCard.js';
import type { A11ySeverity, A11yViolation } from '../../hooks/useA11yAudit.js';

const SEVERITY_ORDER: A11ySeverity[] = ['critical', 'serious', 'moderate', 'minor'];

function groupBySeverity(violations: A11yViolation[]): Record<A11ySeverity, A11yViolation[]> {
  return {
    critical: violations.filter(v => v.severity === 'critical'),
    serious: violations.filter(v => v.severity === 'serious'),
    moderate: violations.filter(v => v.severity === 'moderate'),
    minor: violations.filter(v => v.severity === 'minor'),
  };
}

export function AccessibilityPage() {
  const { data, loading, error, refetch } = useA11yAudit();

  if (loading) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
        <h1>Accessibility Audit</h1>
        <p data-testid="loading-state">Loading audit results…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
        <h1>Accessibility Audit</h1>
        <p data-testid="error-state" style={{ color: '#dc2626' }}>
          Error: {error}
        </p>
        <button type="button" onClick={refetch}>
          Retry
        </button>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
        <h1>Accessibility Audit</h1>
        <p data-testid="empty-state">No audit data available.</p>
      </main>
    );
  }

  const grouped = groupBySeverity(data.violations);
  const criticalCount = grouped.critical.length;
  const totalViolations = data.violations.length;

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Accessibility Audit</h1>

      <section
        data-testid="summary-stats"
        aria-label="Summary statistics"
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 32,
          flexWrap: 'wrap',
        }}
      >
        <div
          data-testid="stat-total-violations"
          style={{
            flex: 1,
            minWidth: 140,
            padding: 16,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 700 }}>{totalViolations}</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Total Violations</div>
        </div>

        <div
          data-testid="stat-critical-count"
          style={{
            flex: 1,
            minWidth: 140,
            padding: 16,
            border: '1px solid #fca5a5',
            borderRadius: 8,
            textAlign: 'center',
            backgroundColor: criticalCount > 0 ? '#fef2f2' : undefined,
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 700, color: '#dc2626' }}>{criticalCount}</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Critical</div>
        </div>

        <div
          data-testid="stat-pages-scanned"
          style={{
            flex: 1,
            minWidth: 140,
            padding: 16,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 700 }}>{data.pagesScanned}</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Pages Scanned</div>
        </div>
      </section>

      {totalViolations === 0 ? (
        <p data-testid="no-violations">No violations found. Great job!</p>
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
                style={{ marginBottom: 24 }}
              >
                <h2
                  style={{
                    textTransform: 'capitalize',
                    marginBottom: 12,
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
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
