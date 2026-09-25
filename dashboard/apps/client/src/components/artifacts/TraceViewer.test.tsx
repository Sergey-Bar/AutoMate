import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { TraceViewer } from './TraceViewer';

describe('TraceViewer', () => {
  it('renders with valid trace data', () => {
    const tracePath = 'test-runs/123/trace.zip';
    renderWithProviders(<TraceViewer tracePath={tracePath} />);
    
    // Check if iframe is rendered
    const iframe = screen.getByTitle('Playwright Trace Viewer');
    expect(iframe).toBeInTheDocument();
    
    const traceUrl = `/artifacts/${tracePath}`;
    const viewerUrl = `https://trace.playwright.dev/?trace=${encodeURIComponent(
      window.location.origin + traceUrl,
    )}`;
    
    expect(iframe).toHaveAttribute('src', viewerUrl);
    
    // Check for "Open in full tab" link
    const link = screen.getByRole('link', { name: /Open in full tab/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', viewerUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    
    // Check for trace filename display
    expect(screen.getByText('Trace: trace.zip')).toBeInTheDocument();
  });

  it('renders empty/null trace gracefully (no crash)', () => {
    // The component expects a string, so the "empty" state of tracePath
    // without causing a TypeScript error or uncaught split() error is an empty string.
    renderWithProviders(<TraceViewer tracePath="" />);
    
    const iframe = screen.getByTitle('Playwright Trace Viewer');
    expect(iframe).toBeInTheDocument();
    
    // The filename display should handle empty string safely
    expect(screen.getByText('Trace:')).toBeInTheDocument();
  });

  it('handles error state or unusual paths gracefully', () => {
    renderWithProviders(<TraceViewer tracePath="something/weird.zip" />);
    expect(screen.getByText('Trace: weird.zip')).toBeInTheDocument();
  });

  it('large trace data path does not cause infinite loop', () => {
    // Pass a very long path
    const largePath = 'a/'.repeat(500) + 'large-trace.zip';
    renderWithProviders(<TraceViewer tracePath={largePath} />);
    
    expect(screen.getByText('Trace: large-trace.zip')).toBeInTheDocument();
    const iframe = screen.getByTitle('Playwright Trace Viewer');
    expect(iframe).toBeInTheDocument();
  });
});
