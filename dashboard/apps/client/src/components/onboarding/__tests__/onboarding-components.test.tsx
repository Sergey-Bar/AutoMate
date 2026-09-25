import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../../test/test-utils';
import { OnboardingWizard } from '../OnboardingWizard';
import { useOnboardingStore } from '../../../store/onboardingStore';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
          const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

const wsSubscribeMock = vi.fn(() => vi.fn());

vi.mock('../../../store/wsStore', () => ({
  useWsStore: (selector: (state: { subscribe: typeof wsSubscribeMock }) => unknown) => selector({ subscribe: wsSubscribeMock }),
}));

describe('onboarding components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOnboardingStore.setState({ hasCompletedOnboarding: false });
  });

  it('shows connection instructions on first step', () => {
    renderWithProviders(<OnboardingWizard />);
    expect(screen.getByText('npm install -D @automate/reporter')).toBeInTheDocument();
  });

  it('advances to waiting state after clicking Next', async () => {
    renderWithProviders(<OnboardingWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Waiting for first test run...')).toBeInTheDocument();
  });

  it('completes onboarding when Skip is clicked on waiting step', async () => {
    renderWithProviders(<OnboardingWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
  });
});
