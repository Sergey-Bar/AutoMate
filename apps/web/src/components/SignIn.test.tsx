import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignIn } from './Access.js';
import { makeHealthDouble } from '../test-utils.js';

/** The sign-in screen offers single sign-on when the install has it (ADR-014, team). */
afterEach(() => window.history.replaceState(null, '', '/'));

describe('sign-in with single sign-on', () => {
  it('offers the provider when the install has OIDC, as a link the browser follows', async () => {
    const health = makeHealthDouble('viewer', {
      signInMethods: vi.fn(async () => ({ oidc: true })),
    });
    render(<SignIn health={health} onSignedIn={() => undefined} />);
    const link = await screen.findByRole('link', { name: 'Sign in with single sign-on' });
    expect(link).toHaveAttribute('href', '/api/v1/auth/oidc/start');
  });

  it('offers no link when the install has none', async () => {
    const signInMethods = vi.fn(async () => ({ oidc: false }));
    render(
      <SignIn
        health={makeHealthDouble('viewer', { signInMethods })}
        onSignedIn={() => undefined}
      />,
    );
    await waitFor(() => expect(signInMethods).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Sign in with single sign-on' })).toBeNull();
  });

  it('says why the provider’s sign-in was refused, in words', async () => {
    window.history.replaceState(null, '', '/?signin=not-invited');
    render(
      <SignIn
        health={makeHealthDouble('viewer', { signInMethods: vi.fn(async () => ({ oidc: true })) })}
        onSignedIn={() => undefined}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You signed in, but nobody has given you access to this install yet.',
    );
  });
});
