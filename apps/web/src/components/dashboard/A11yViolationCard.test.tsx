import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { A11yViolationCard } from './A11yViolationCard.js';
import type { A11yViolation } from '../../lib/api.js';

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
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('violation-rule-id')).toHaveTextContent('color-contrast');
  });

  it('renders the description', () => {
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('violation-description')).toHaveTextContent(
      'Elements must have sufficient color contrast'
    );
  });

  it('renders the severity badge', () => {
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('violation-severity-badge')).toHaveTextContent('serious');
  });

  it('renders the element selector', () => {
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('violation-element')).toHaveTextContent('button.submit');
  });

  it('renders the fix suggestion', () => {
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('violation-fix')).toHaveTextContent(
      'Increase contrast ratio to at least 4.5:1'
    );
  });

  it('renders the page', () => {
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('violation-page')).toHaveTextContent('/home');
  });

  it('renders the violation card container', () => {
    render(<A11yViolationCard violation={baseViolation} />);
    expect(screen.getByTestId('a11y-violation-card')).toBeInTheDocument();
  });

  it('renders critical severity badge', () => {
    const critical: A11yViolation = { ...baseViolation, severity: 'critical' };
    render(<A11yViolationCard violation={critical} />);
    expect(screen.getByTestId('violation-severity-badge')).toHaveTextContent('critical');
  });

  it('renders moderate severity badge', () => {
    const moderate: A11yViolation = { ...baseViolation, severity: 'moderate' };
    render(<A11yViolationCard violation={moderate} />);
    expect(screen.getByTestId('violation-severity-badge')).toHaveTextContent('moderate');
  });

  it('renders minor severity badge', () => {
    const minor: A11yViolation = { ...baseViolation, severity: 'minor' };
    render(<A11yViolationCard violation={minor} />);
    expect(screen.getByTestId('violation-severity-badge')).toHaveTextContent('minor');
  });

  it('exports default export', async () => {
    const module = await import('./A11yViolationCard.js');
    expect(module.default).toBeDefined();
  });
});
