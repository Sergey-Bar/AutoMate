/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NetworkWaterfall } from './NetworkWaterfall.js';
import type { NetworkRequest } from './NetworkWaterfall.js';

describe('NetworkWaterfall', () => {
  const requests: NetworkRequest[] = [
    { url: 'https://api.example.com/users', method: 'GET', startMs: 0, durationMs: 120, status: 200 },
    { url: 'https://api.example.com/login', method: 'POST', startMs: 120, durationMs: 80, status: 201 },
    { url: 'https://api.example.com/missing', method: 'GET', startMs: 200, durationMs: 50, status: 404 },
  ];

  it('renders empty state when no requests provided', () => {
    render(<NetworkWaterfall requests={[]} />);
    expect(screen.getByTestId('network-waterfall-empty')).toBeInTheDocument();
    expect(screen.getByText(/No network requests recorded/)).toBeInTheDocument();
  });

  it('renders waterfall with requests', () => {
    render(<NetworkWaterfall requests={requests} />);
    expect(screen.getByTestId('network-waterfall')).toBeInTheDocument();
    expect(screen.getByTestId('waterfall-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('waterfall-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('waterfall-row-2')).toBeInTheDocument();
  });

  it('renders HTTP methods', () => {
    render(<NetworkWaterfall requests={requests} />);
    expect(screen.getByTestId('waterfall-method-0')).toHaveTextContent('GET');
    expect(screen.getByTestId('waterfall-method-1')).toHaveTextContent('POST');
  });

  it('renders status badges', () => {
    render(<NetworkWaterfall requests={requests} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('200');
    expect(screen.getByTestId('waterfall-status-1')).toHaveTextContent('201');
    expect(screen.getByTestId('waterfall-status-2')).toHaveTextContent('404');
  });

  it('renders duration labels', () => {
    render(<NetworkWaterfall requests={requests} />);
    expect(screen.getByTestId('waterfall-duration-0')).toHaveTextContent('120ms');
    expect(screen.getByTestId('waterfall-duration-1')).toHaveTextContent('80ms');
  });

  it('renders bars with correct widths proportional to total duration', () => {
    render(<NetworkWaterfall requests={requests} />);
    // totalMs = 250, req0 width = 120/250 * 100 = 48%
    const bar0 = screen.getByTestId('waterfall-bar-0');
    expect(bar0).toHaveStyle({ width: '48%' });
  });

  it('renders a single request without errors', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://x.com', method: 'DELETE', startMs: 0, durationMs: 10, status: 204 }]} />);
    expect(screen.getByTestId('waterfall-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('waterfall-method-0')).toHaveTextContent('DELETE');
  });

  it('renders 500-level status badge', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/err', method: 'GET', startMs: 0, durationMs: 50, status: 500 }]} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('500');
  });

  it('500 bar uses danger color #ef4444', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/err', method: 'GET', startMs: 0, durationMs: 50, status: 500 }]} />);
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  it('renders 0 status (unknown) badge', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/fail', method: 'GET', startMs: 0, durationMs: 50, status: 0 }]} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('0');
  });

  it('0 status bar uses gray color #6b7280', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/fail', method: 'GET', startMs: 0, durationMs: 50, status: 0 }]} />);
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ backgroundColor: '#6b7280' });
  });

  it('renders 3xx redirect status badge', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/old', method: 'GET', startMs: 0, durationMs: 30, status: 301 }]} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('301');
  });

  it('3xx bar uses gray color #6b7280 (default)', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/old', method: 'GET', startMs: 0, durationMs: 30, status: 301 }]} />);
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ backgroundColor: '#6b7280' });
  });

  it('renders string status codes correctly', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/ok', method: 'GET', startMs: 0, durationMs: 40, status: '200' }]} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('200');
  });

  it('string 200 status bar uses success color #22c55e', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/ok', method: 'GET', startMs: 0, durationMs: 40, status: '200' }]} />);
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ backgroundColor: '#22c55e' });
  });

  it('renders non-numeric string status as secondary', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/x', method: 'GET', startMs: 0, durationMs: 40, status: 'UNKNOWN' }]} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('UNKNOWN');
    // NaN code → gray color
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ backgroundColor: '#6b7280' });
  });

  it('truncates URLs longer than 40 characters in the display', () => {
    const longUrl = 'https://very-long-domain-name.example.com/api/v1/endpoint/with/many/segments';
    render(<NetworkWaterfall requests={[{ url: longUrl, method: 'GET', startMs: 0, durationMs: 10, status: 200 }]} />);
    const urlCell = screen.getByTestId('waterfall-url-0');
    // Should start with the ellipsis character
    expect(urlCell.textContent).toMatch(/^…/);
    // The original URL should appear as the title attribute on the cell
    expect(urlCell).toHaveAttribute('title', longUrl);
  });

  it('does not truncate URLs of exactly 40 characters', () => {
    const url40 = 'https://example.com/exactly/forty/chars!'; // exactly 40 chars
    expect(url40.length).toBe(40);
    render(<NetworkWaterfall requests={[{ url: url40, method: 'GET', startMs: 0, durationMs: 10, status: 200 }]} />);
    const urlCell = screen.getByTestId('waterfall-url-0');
    expect(urlCell.textContent).not.toMatch(/^…/);
  });

  it('bar left offset reflects startMs relative to totalMs', () => {
    const reqs: NetworkRequest[] = [
      { url: 'https://api.example.com/a', method: 'GET', startMs: 100, durationMs: 100, status: 200 },
    ];
    // totalMs = 200, leftPct = 100/200 * 100 = 50%
    render(<NetworkWaterfall requests={reqs} />);
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ left: '50%' });
  });

  it('renders 503 status with danger bar color', () => {
    render(<NetworkWaterfall requests={[{ url: 'https://api.example.com/svc', method: 'GET', startMs: 0, durationMs: 20, status: 503 }]} />);
    expect(screen.getByTestId('waterfall-status-0')).toHaveTextContent('503');
    expect(screen.getByTestId('waterfall-bar-0')).toHaveStyle({ backgroundColor: '#ef4444' });
  });
});
