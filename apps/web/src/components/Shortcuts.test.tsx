import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PREFERENCES_KEY,
  PreferencesProvider,
  readPreferences,
  usePreferences,
} from '../theme/preferences.js';
import { isTypingTarget } from './Shortcuts.js';
import { MemoryRouter } from '../router.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
  // jsdom has no <dialog> behaviour; the shortcuts sheet only needs open and close.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith('/api/v1/auth/whoami'))
        return reply({ actor: 'a', role: 'admin', mode: 'open' });
      if (url.endsWith('/api/v1/runs')) return reply([]);
      if (url.endsWith('/api/v1/portfolio')) return reply({ projects: [] });
      if (url.endsWith('/api/v1/report-deliveries')) return reply({ deliveries: [] });
      if (url.includes('/api/v1/notification-channels')) return reply({ channels: [] });
      if (url.includes('/api/v1/report-subscriptions')) return reply({ subscriptions: [] });
      if (url.includes('/api/v1/report-preview')) return reply({ status: 'good', text: 'ok' });
      return reply({});
    }),
  );
}

const press = (key: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

describe('keyboard shortcuts', () => {
  it('g then a letter navigates, ? opens the help, and a field swallows both', async () => {
    stubApi();
    const { container } = render(<MemoryRouter initialEntries={['/dashboard/now']} />);
    await screen.findByTestId('now-page', {}, { timeout: 10_000 });
    press('g');
    press('s');
    expect(await screen.findByTestId('notifications-page', {}, { timeout: 10_000 })).toBeTruthy();
    press('?');
    await waitFor(() =>
      expect(screen.getByTestId('shortcuts-help').closest('dialog')?.open).toBe(true),
    );
    await expectNoBlockingAxeViolations(container);
    // A letter typed into a field is the field's.
    const field = screen.getByLabelText('Name');
    press('g', field);
    press('n', field);
    expect(screen.getByTestId('notifications-page')).toBeTruthy();
    // A modified key and an unknown chord do nothing.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true }));
    });
    press('g');
    press('z');
    expect(screen.getByTestId('notifications-page')).toBeTruthy();
  });

  it('j and k move through rows, and Enter opens the focused one', async () => {
    stubApi();
    render(<MemoryRouter initialEntries={['/dashboard/reports']} />);
    await screen.findByTestId('notifications-page', {}, { timeout: 10_000 });
    const list = document.createElement('ul');
    list.innerHTML =
      '<li><button type="button">one</button></li><li><button type="button">two</button></li>';
    const clicked = vi.fn();
    list.querySelectorAll('button')[1]?.addEventListener('click', clicked);
    document.querySelector('[data-page]')?.appendChild(list);
    press('k');
    press('j');
    press('j');
    expect(document.activeElement?.textContent).toBe('two');
    press('Enter');
    expect(clicked).toHaveBeenCalledOnce();
    list.remove();
    press('j');
  });

  it('knows a field from the page', () => {
    const input = document.createElement('input');
    const div = document.createElement('div');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('preferences', () => {
  function Probe() {
    const { preferences, update } = usePreferences();
    return (
      <button
        type="button"
        onClick={() => update({ focus: !preferences.focus, density: 'compact', motion: 'reduced' })}
      >
        toggle
      </button>
    );
  }

  it('reads only valid stored values, and falls back to the system for motion', () => {
    expect(readPreferences(null)).toEqual({ focus: false, density: 'comfortable', motion: 'full' });
    expect(readPreferences('not json')).toMatchObject({ density: 'comfortable' });
    expect(readPreferences('{"focus":true,"density":"compact","motion":"reduced"}')).toEqual({
      focus: true,
      density: 'compact',
      motion: 'reduced',
    });
    expect(readPreferences('{"focus":"yes","density":"tiny","motion":"wild"}')).toEqual({
      focus: false,
      density: 'comfortable',
      motion: 'full',
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(readPreferences(null).motion).toBe('reduced');
  });

  it('sets the attributes the stylesheet reads, and keeps them', async () => {
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(document.documentElement.dataset['focus']).toBe('off');
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(document.documentElement.dataset).toMatchObject({
      focus: 'on',
      density: 'compact',
      motion: 'reduced',
    });
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}')).toMatchObject({
      focus: true,
    });
  });

  it('is offered in the command palette', async () => {
    stubApi();
    render(<MemoryRouter initialEntries={['/dashboard/now']} />);
    await screen.findByTestId('now-page', {}, { timeout: 10_000 });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(await screen.findByText('Focus mode')).toBeTruthy();
    expect(screen.getByText('Compact density')).toBeTruthy();
    expect(screen.getByText(/Reduce motion|Full motion/u)).toBeTruthy();
    // Each one flips its attribute. The palette is open now; selecting closes it.
    const choose = (label: RegExp, reopen: boolean) => {
      if (reopen) {
        act(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
        });
      }
      act(() => {
        screen
          .getByText(label)
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
    };
    choose(/^Focus mode$/u, false);
    await waitFor(() => expect(document.documentElement.dataset['focus']).toBe('on'));
    choose(/^Compact density$/u, true);
    await waitFor(() => expect(document.documentElement.dataset['density']).toBe('compact'));
    choose(/^(Reduce motion|Full motion)$/u, true);
    await waitFor(() => expect(localStorage.getItem(PREFERENCES_KEY)).toMatch(/"motion"/u));
  });

  it('does nothing outside a provider, rather than throwing', () => {
    render(<Probe />);
    expect(() => act(() => screen.getByRole('button', { name: 'toggle' }).click())).not.toThrow();
  });
});

describe('the shortcuts sheet', () => {
  it('closes from its own button', async () => {
    stubApi();
    render(<MemoryRouter initialEntries={['/dashboard/now']} />);
    await screen.findByTestId('now-page', {}, { timeout: 10_000 });
    press('?');
    const sheet = screen.getByTestId('shortcuts-help');
    await waitFor(() => expect(sheet.closest('dialog')?.open).toBe(true));
    act(() => screen.getByRole('button', { name: 'Close' }).click());
    await waitFor(() => expect(sheet.closest('dialog')?.open).toBe(false));
  });
});

describe('the now route', () => {
  it('opens a falling repository from its one action', async () => {
    stubApi();
    const base = vi.mocked(fetch);
    const project = {
      projectId: 'p-1',
      name: 'Service',
      slug: 'service',
      branch: 'main',
      score: 40,
      letter: 'D',
      incomplete: false,
      limiter: 'Limited by Security',
      worst: null,
      trend: -2,
      lastReportAt: '2026-10-25T10:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith('/api/v1/portfolio')
          ? new Response(JSON.stringify({ projects: [project] }), { status: 200 })
          : base(input, init),
      ),
    );
    render(<MemoryRouter initialEntries={['/dashboard/now']} />);
    await screen.findByText('Service is graded D', {}, { timeout: 10_000 });
    act(() => screen.getAllByRole('button', { name: 'Open health' })[0]?.click());
    await waitFor(() => expect(screen.queryByTestId('now-page')).toBeNull(), { timeout: 10_000 });
  });
});
