import React from 'react';
import type { A11yViolation, A11ySeverity } from '../../hooks/useA11yAudit.js';

const SEVERITY_COLORS: Record<A11ySeverity, string> = {
  critical: '#dc2626',
  serious: '#ea580c',
  moderate: '#ca8a04',
  minor: '#2563eb',
};

const SEVERITY_BG: Record<A11ySeverity, string> = {
  critical: '#fef2f2',
  serious: '#fff7ed',
  moderate: '#fefce8',
  minor: '#eff6ff',
};

interface A11yViolationCardProps {
  violation: A11yViolation;
}

export function A11yViolationCard({ violation }: A11yViolationCardProps) {
  const color = SEVERITY_COLORS[violation.severity];
  const bg = SEVERITY_BG[violation.severity];

  return (
    <article
      data-testid="a11y-violation-card"
      style={{
        border: `1px solid ${color}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        backgroundColor: bg,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          data-testid="violation-severity-badge"
          style={{
            backgroundColor: color,
            color: '#fff',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          {violation.severity}
        </span>
        <code
          data-testid="violation-rule-id"
          style={{ fontSize: 13, fontFamily: 'monospace', color: '#374151' }}
        >
          {violation.ruleId}
        </code>
      </header>

      <p data-testid="violation-description" style={{ margin: '0 0 8px', fontWeight: 600 }}>
        {violation.description}
      </p>

      <dl style={{ margin: 0 }}>
        <div style={{ marginBottom: 4 }}>
          <dt style={{ display: 'inline', fontWeight: 600, fontSize: 13 }}>Element: </dt>
          <dd style={{ display: 'inline', margin: 0 }}>
            <code data-testid="violation-element" style={{ fontFamily: 'monospace', fontSize: 13 }}>
              {violation.element}
            </code>
          </dd>
        </div>
        <div style={{ marginBottom: 4 }}>
          <dt style={{ display: 'inline', fontWeight: 600, fontSize: 13 }}>Page: </dt>
          <dd data-testid="violation-page" style={{ display: 'inline', margin: 0, fontSize: 13 }}>
            {violation.page}
          </dd>
        </div>
        <div>
          <dt style={{ display: 'inline', fontWeight: 600, fontSize: 13 }}>How to fix: </dt>
          <dd data-testid="violation-fix" style={{ display: 'inline', margin: 0, fontSize: 13 }}>
            {violation.fix}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default A11yViolationCard;
