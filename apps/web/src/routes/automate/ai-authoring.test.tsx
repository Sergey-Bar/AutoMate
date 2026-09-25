/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../components/automate/NLTestGenerator.js', () => ({
  NLTestGenerator: () => React.createElement('div', { 'data-testid': 'nl-test-generator' }, 'NLTestGenerator'),
  default: () => React.createElement('div', { 'data-testid': 'nl-test-generator' }, 'NLTestGenerator'),
}));

vi.mock('../automate.js', () => ({
  Route: { id: 'automate' },
}));

import { AIAuthoringPage, Route } from './ai-authoring.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AIAuthoringPage', () => {
  it('renders the page heading', () => {
    render(<AIAuthoringPage />);
    expect(screen.getByText('AI Test Authoring')).toBeInTheDocument();
  });

  it('renders the description text', () => {
    render(<AIAuthoringPage />);
    expect(screen.getByText(/Describe a test scenario in plain English/)).toBeInTheDocument();
  });

  it('renders the NLTestGenerator component', () => {
    render(<AIAuthoringPage />);
    expect(screen.getByTestId('nl-test-generator')).toBeInTheDocument();
  });

  it('renders the page container', () => {
    render(<AIAuthoringPage />);
    expect(screen.getByTestId('ai-authoring-page')).toBeInTheDocument();
  });

  it('exports default export', async () => {
    const module = await import('./ai-authoring.js');
    expect(module.default).toBeDefined();
  });

  it('Route is exported and has options', () => {
    expect(Route).toBeDefined();
    const opts = (Route as unknown as { options: Record<string, unknown> }).options;
    expect(opts).toBeDefined();
    expect(opts['path']).toBe('ai-authoring');
  });

  it('Route component lambda renders AIAuthoringPage', () => {
    const opts = (Route as unknown as { options: { component: () => React.JSX.Element } }).options;
    render(opts.component());
    expect(screen.getAllByTestId('ai-authoring-page').length).toBeGreaterThan(0);
  });

  it('Route getParentRoute returns defined parent', () => {
    const opts = (Route as unknown as { options: { getParentRoute: () => unknown } }).options;
    const parent = opts.getParentRoute();
    expect(parent).toBeDefined();
  });
});
