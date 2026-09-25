import React from 'react';
import { Badge, Card } from '@automate/ui';
import type { A11yViolation, A11ySeverity } from '../../lib/api.js';

const SEVERITY_VARIANT: Record<A11ySeverity, 'danger' | 'warning' | 'secondary' | 'default'> = {
  critical: 'danger',
  serious: 'warning',
  moderate: 'secondary',
  minor: 'default',
};

interface A11yViolationCardProps {
  violation: A11yViolation;
}

export function A11yViolationCard({ violation }: A11yViolationCardProps) {
  const variant = SEVERITY_VARIANT[violation.severity];

  return (
    <Card data-testid="a11y-violation-card" className="p-4 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={variant} data-testid="violation-severity-badge">
          {violation.severity}
        </Badge>
        <code data-testid="violation-rule-id" className="text-sm font-mono text-gray-700">
          {violation.ruleId}
        </code>
      </div>

      <p data-testid="violation-description" className="font-semibold mb-2">
        {violation.description}
      </p>

      <dl className="text-sm space-y-1">
        <div>
          <dt className="inline font-semibold">Element: </dt>
          <dd className="inline m-0">
            <code data-testid="violation-element" className="font-mono">
              {violation.element}
            </code>
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Page: </dt>
          <dd data-testid="violation-page" className="inline m-0">
            {violation.page}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">How to fix: </dt>
          <dd data-testid="violation-fix" className="inline m-0">
            {violation.fix}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export default A11yViolationCard;
