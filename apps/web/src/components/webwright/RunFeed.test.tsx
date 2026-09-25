/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RunFeed } from './RunFeed.js';
import type { AgentStep } from './RunFeed.js';

const sampleSteps: AgentStep[] = [
  { type: 'navigate', description: 'Navigating to https://example.com', timestamp: '2024-01-01T10:00:00Z' },
  { type: 'click', description: 'Clicking on "Sign In" button', timestamp: '2024-01-01T10:00:05Z' },
  { type: 'screenshot', description: 'Taking screenshot of current state', timestamp: '2024-01-01T10:00:10Z', screenshot: 'data:image/png;base64,abc' },
];

describe('RunFeed', () => {
  it('renders loading state', () => {
    render(<RunFeed steps={[]} isLoading={true} />);
    expect(screen.getByTestId('run-feed-loading')).toBeInTheDocument();
  });

  it('renders empty state when no steps', () => {
    render(<RunFeed steps={[]} />);
    expect(screen.getByTestId('run-feed-empty')).toBeInTheDocument();
  });

  it('renders all steps', () => {
    render(<RunFeed steps={sampleSteps} />);
    expect(screen.getByTestId('run-feed')).toBeInTheDocument();
    expect(screen.getByTestId('run-feed-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('run-feed-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-feed-step-2')).toBeInTheDocument();
  });

  it('renders step descriptions', () => {
    render(<RunFeed steps={sampleSteps} />);
    expect(screen.getByTestId('step-description-0')).toHaveTextContent('Navigating to https://example.com');
    expect(screen.getByTestId('step-description-1')).toHaveTextContent('Clicking on "Sign In" button');
  });

  it('renders step types', () => {
    render(<RunFeed steps={sampleSteps} />);
    expect(screen.getByTestId('step-type-0')).toHaveTextContent('navigate');
    expect(screen.getByTestId('step-type-1')).toHaveTextContent('click');
  });

  it('renders screenshot when provided', () => {
    render(<RunFeed steps={sampleSteps} />);
    expect(screen.getByTestId('step-screenshot-2')).toBeInTheDocument();
    expect(screen.getByTestId('step-screenshot-2')).toHaveAttribute('src', 'data:image/png;base64,abc');
  });

  it('does not render screenshot element when not provided', () => {
    render(<RunFeed steps={sampleSteps} />);
    expect(screen.queryByTestId('step-screenshot-0')).not.toBeInTheDocument();
  });
});
