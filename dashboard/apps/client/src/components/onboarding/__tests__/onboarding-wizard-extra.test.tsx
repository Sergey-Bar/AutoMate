import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/test-utils';
import { OnboardingWizard } from '../OnboardingWizard';
import { useOnboardingStore } from '../../../store/onboardingStore';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _i, animate: _a, exit: _e, variants: _v, whileHover: _wh, whileTap: _wt, transition: _t, layout: _l, layoutId: _lid, ...rest }: Record<string, unknown>) => {
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
  useWsStore: (selector: (state: { subscribe: typeof wsSubscribeMock }) => unknown) =>
    selector({ subscribe: wsSubscribeMock }),
}));

describe('OnboardingWizard extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOnboardingStore.setState({ hasCompletedOnboarding: false });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders nothing when onboarding is already completed', () => {
    useOnboardingStore.setState({ hasCompletedOnboarding: true });
    const { container } = renderWithProviders(<OnboardingWizard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('close X button calls setCompleted immediately', async () => {
    renderWithProviders(<OnboardingWizard />);
    await userEvent.click(screen.getByRole('button', { name: 'Close wizard' }));
    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('copy button writes command text to clipboard and shows Copied!', async () => {
    renderWithProviders(<OnboardingWizard />);

    const copyBtns = screen.getAllByRole('button', { name: /Copy command/i });
    await userEvent.click(copyBtns[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'npm install -D @automate/reporter',
    );
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('ws run:start event triggers setCompleted', () => {
    renderWithProviders(<OnboardingWizard />);

    // The subscribe mock receives ('*', handler)
    expect(wsSubscribeMock).toHaveBeenCalledWith('*', expect.any(Function));

    const handler = wsSubscribeMock.mock.calls[0][1] as (event: unknown) => void;
    handler({ type: 'run:start' });

    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('ws run:start via topic field also triggers setCompleted', () => {
    renderWithProviders(<OnboardingWizard />);

    const handler = wsSubscribeMock.mock.calls[0][1] as (event: unknown) => void;
    handler({ topic: 'run:start' });

    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('ws event with unrelated type does not trigger setCompleted', () => {
    renderWithProviders(<OnboardingWizard />);

    const handler = wsSubscribeMock.mock.calls[0][1] as (event: unknown) => void;
    handler({ type: 'test:done' });

    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('copy button for second command copies correct text', async () => {
    renderWithProviders(<OnboardingWizard />);

    const copyBtns = screen.getAllByRole('button', { name: /Copy command/i });
    await userEvent.click(copyBtns[1]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "reporter: [['list'], ['@automate/reporter']]",
    );
  });

  it('copied state shows checkmark icon after copy', async () => {
    renderWithProviders(<OnboardingWizard />);

    const copyBtns = screen.getAllByRole('button', { name: /Copy command/i });
    await userEvent.click(copyBtns[0]);

    // After clicking, button text changes to 'Copied!'
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const copiedBtn = buttons.find((b) => b.textContent?.includes('Copied!'));
      expect(copiedBtn).toBeDefined();
    });
  });
});
