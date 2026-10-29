import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageGuide } from './PageGuide.js';
import { routeManifest } from '../route-manifest.js';
import { pageGuidance } from '../page-guidance.js';

afterEach(cleanup);

describe('contextual page guidance', () => {
  it('covers every registered screen, including parameterized detail pages', () => {
    expect(Object.keys(pageGuidance).sort()).toEqual(routeManifest.map((route) => route.id).sort());
    for (const route of routeManifest) {
      const view = render(<PageGuide pathname={route.path.replace(/:[^/]+/gu, 'example')} />);
      expect(screen.getByText(`How to use ${route.label}`)).toBeTruthy();
      view.unmount();
    }
  });

  it('opens its native disclosure and resets when navigating to another screen', async () => {
    const user = userEvent.setup();
    const view = render(<PageGuide pathname="/dashboard/runs" />);
    const summary = screen.getByText('How to use Runs').closest('summary');
    expect(summary).not.toBeNull();
    if (!summary) throw new Error('Expected a native summary');
    await user.click(summary);
    expect(summary?.parentElement?.hasAttribute('open')).toBe(true);
    expect(screen.getByText(pageGuidance.runs.purpose)).toBeTruthy();
    view.rerender(<PageGuide pathname="/dashboard/quarantine" />);
    expect(screen.getByText('How to use Quarantine').closest('details')?.hasAttribute('open')).toBe(
      false,
    );
  });

  it('describes quarantine as the API does: approved entries are released, rejections are final', () => {
    // `QUARANTINE_TRANSITIONS` in apps/api/src/modules/dashboard/schemas.ts allows
    // approved -> released, and auto-quarantine releases entries after a clean streak.
    const { remember } = pageGuidance.quarantine;
    expect(remember).not.toMatch(/approved[^.]*final/i);
    expect(remember).toMatch(/released/i);
    expect(remember).toMatch(/reject[^.]*final/i);
  });

  it('does not display unrelated guidance on an unknown path', () => {
    const view = render(<PageGuide pathname="/not-a-page" />);
    expect(view.container.innerHTML).toBe('');
  });
});
