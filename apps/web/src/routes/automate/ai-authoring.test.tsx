import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { AIAuthoringPage } from './ai-authoring.js';

vi.mock('../../components/automate/NLTestGenerator.js', () => ({
  NLTestGenerator: () => React.createElement('div', { 'data-testid': 'nl-test-generator' }, 'NLTestGenerator'),
  default: () => React.createElement('div', { 'data-testid': 'nl-test-generator' }, 'NLTestGenerator'),
}));

describe('AIAuthoringPage', () => {
  it('renders the page heading', () => {
    const html = renderToString(<AIAuthoringPage />);
    expect(html).toContain('AI Test Authoring');
  });

  it('renders the description text', () => {
    const html = renderToString(<AIAuthoringPage />);
    expect(html).toContain('Describe a test scenario in plain English');
  });

  it('renders the NLTestGenerator component', () => {
    const html = renderToString(<AIAuthoringPage />);
    expect(html).toContain('NLTestGenerator');
  });

  it('renders a section element', () => {
    const html = renderToString(<AIAuthoringPage />);
    expect(html).toContain('<section');
  });

  it('exports default export', async () => {
    const module = await import('./ai-authoring.js');
    expect(module.default).toBeDefined();
  });
});
