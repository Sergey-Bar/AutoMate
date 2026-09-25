import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { A11yViolationCard } from './A11yViolationCard.js';
import type { A11yViolation } from '../../hooks/useA11yAudit.js';

const baseViolation: A11yViolation = {
  id: 'v1',
  ruleId: 'color-contrast',
  description: 'Elements must have sufficient color contrast',
  severity: 'serious',
  element: 'button.submit',
  fix: 'Increase contrast ratio to at least 4.5:1',
  page: '/home',
};

describe('A11yViolationCard', () => {
  it('renders the rule ID', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('color-contrast');
  });

  it('renders the description', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('Elements must have sufficient color contrast');
  });

  it('renders the severity badge', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('serious');
  });

  it('renders the element selector', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('button.submit');
  });

  it('renders the fix suggestion', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('Increase contrast ratio to at least 4.5:1');
  });

  it('renders the page', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('/home');
  });

  it('renders as an article element', () => {
    const html = renderToString(<A11yViolationCard violation={baseViolation} />);
    expect(html).toContain('<article');
  });

  it('renders critical severity with correct label', () => {
    const critical: A11yViolation = { ...baseViolation, severity: 'critical' };
    const html = renderToString(<A11yViolationCard violation={critical} />);
    expect(html).toContain('critical');
  });

  it('renders moderate severity', () => {
    const moderate: A11yViolation = { ...baseViolation, severity: 'moderate' };
    const html = renderToString(<A11yViolationCard violation={moderate} />);
    expect(html).toContain('moderate');
  });

  it('renders minor severity', () => {
    const minor: A11yViolation = { ...baseViolation, severity: 'minor' };
    const html = renderToString(<A11yViolationCard violation={minor} />);
    expect(html).toContain('minor');
  });

  it('exports default export', async () => {
    const module = await import('./A11yViolationCard.js');
    expect(module.default).toBeDefined();
  });
});
