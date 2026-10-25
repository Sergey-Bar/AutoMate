import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HealthClient } from '../lib/health-client.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { ConnectRunnerPanel, PairDevicePanel, PairPage } from './Pairing.js';
import { QrCode } from './QrCode.js';
import { SessionGate } from './SessionGate.js';

function client(overrides: Partial<HealthClient>): HealthClient {
  return overrides as HealthClient;
}

describe('QrCode', () => {
  it('draws one path of modules in the current colour, with no colour literal', () => {
    render(<QrCode value="https://automate.local:8443/dashboard/pair?code=042137" label="link" />);
    const svg = screen.getByRole('img', { name: 'link' });
    const path = svg.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('currentColor');
    expect(path?.getAttribute('d')?.length ?? 0).toBeGreaterThan(500);
  });
});

describe('PairDevicePanel', () => {
  it('pairs an operator, and says so when the API refuses', async () => {
    const user = userEvent.setup();
    const issuePairingCode = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { detail: 'This needs the admin role' }))
      .mockRejectedValueOnce(new Error('offline'));
    render(<PairDevicePanel health={client({ issuePairingCode })} />);
    await user.type(screen.getByLabelText('Device name'), 'Laptop');
    await user.selectOptions(screen.getByLabelText('Device role'), 'operator');
    await user.click(screen.getByRole('button', { name: 'Get a code' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This needs the admin role');
    expect(issuePairingCode).toHaveBeenCalledWith({ deviceName: 'Laptop', role: 'operator' });
    await user.click(screen.getByRole('button', { name: 'Get a code' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Could not issue a code'),
    );
  });

  it('issues a code for a named device and shows it with its QR code', async () => {
    const user = userEvent.setup();
    const issuePairingCode = vi.fn(async () => ({
      id: 'p',
      code: '042137',
      deviceName: 'Phone',
      role: 'viewer' as const,
      expiresAt: '2026-10-25T12:10:00.000Z',
      pairUrl: 'https://automate.local:8443/dashboard/pair?code=042137',
    }));
    const { container } = render(<PairDevicePanel health={client({ issuePairingCode })} />);
    await user.type(screen.getByLabelText('Device name'), 'Phone');
    await user.click(screen.getByRole('button', { name: 'Get a code' }));
    expect(await screen.findByText('042137')).toBeTruthy();
    expect(issuePairingCode).toHaveBeenCalledWith({ deviceName: 'Phone', role: 'viewer' });
    expect(screen.getByRole('img', { name: 'Pairing link for Phone' })).toBeTruthy();
    await expectNoBlockingAxeViolations(container);
  });
});

describe('PairPage', () => {
  it('spends a code from the link and reports a wrong one', async () => {
    const user = userEvent.setup();
    const onPaired = vi.fn();
    const pair = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('x'), { detail: 'That code is wrong or has expired' }),
      )
      .mockResolvedValueOnce({ role: 'viewer', deviceName: 'Phone' });
    const { container } = render(
      <PairPage health={client({ pair })} initialCode="042137" onPaired={onPaired} />,
    );
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/wrong or has expired/);
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    await waitFor(() => expect(onPaired).toHaveBeenCalledOnce());
    expect(pair).toHaveBeenCalledWith('042137');
    await expectNoBlockingAxeViolations(container);
  });

  it('keeps only digits, and waits for six of them', async () => {
    const user = userEvent.setup();
    render(<PairPage health={client({})} initialCode="" onPaired={() => undefined} />);
    await user.type(screen.getByLabelText('Pairing code'), '12a3');
    expect((screen.getByLabelText('Pairing code') as HTMLInputElement).value).toBe('123');
    expect((screen.getByRole('button', { name: 'Pair' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ConnectRunnerPanel', () => {
  it('names the address this browser used, and warns when it is plain HTTP', () => {
    const { rerender } = render(<ConnectRunnerPanel origin="http://192.168.1.10:8080" />);
    expect(screen.getByText(/AUTOMATE_API_URL=http:\/\/192\.168\.1\.10:8080/u)).toBeTruthy();
    expect(screen.getByText(/runner refuses it/u)).toBeTruthy();
    rerender(<ConnectRunnerPanel origin="https://192.168.1.10:8443" />);
    expect(screen.queryByText(/runner refuses it/u)).toBeNull();
  });
});

describe('SessionGate', () => {
  it('signs in from the gate and then shows the page', async () => {
    const user = userEvent.setup();
    let role: 'viewer' | null = null;
    const whoami = vi.fn(async () => ({ actor: 'anonymous', role, mode: 'enforced' as const }));
    const signIn = vi.fn(async () => {
      role = 'viewer';
    });
    render(
      <SessionGate health={client({ whoami, signIn })} bypass={false}>
        <p>dashboard</p>
      </SessionGate>,
    );
    await user.type(await screen.findByLabelText('Token or key'), 'amt_x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('dashboard')).toBeTruthy();
  });

  it('ignores an answer that arrives after it was unmounted', async () => {
    let answer: (value: unknown) => void = () => undefined;
    let fail: (reason: unknown) => void = () => undefined;
    const whoami = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const first = render(
      <SessionGate health={client({ whoami })} bypass={false}>
        <p>dashboard</p>
      </SessionGate>,
    );
    first.unmount();
    answer({ actor: 'anonymous', role: null, mode: 'enforced' });
    const second = render(
      <SessionGate health={client({ whoami })} bypass={false}>
        <p>dashboard</p>
      </SessionGate>,
    );
    second.unmount();
    fail(new Error('late'));
    await waitFor(() => expect(whoami).toHaveBeenCalledTimes(2));
  });

  it('asks for sign-in when the API says nobody is calling', async () => {
    const whoami = vi.fn(async () => ({
      actor: 'anonymous',
      role: null,
      mode: 'enforced' as const,
    }));
    render(
      <SessionGate health={client({ whoami })} bypass={false}>
        <p>dashboard</p>
      </SessionGate>,
    );
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('dashboard')).toBeNull();
  });

  it('renders the page for a signed-in caller, an unreachable API, and the pairing page', async () => {
    const signedIn = vi.fn(async () => ({
      actor: 'session',
      role: 'admin' as const,
      mode: 'enforced' as const,
    }));
    const { unmount } = render(
      <SessionGate health={client({ whoami: signedIn })} bypass={false}>
        <p>dashboard</p>
      </SessionGate>,
    );
    await waitFor(() => expect(signedIn).toHaveBeenCalled());
    expect(screen.getByText('dashboard')).toBeTruthy();
    unmount();

    const offline = vi.fn(async () => Promise.reject(new Error('offline')));
    const second = render(
      <SessionGate health={client({ whoami: offline })} bypass={false}>
        <p>dashboard</p>
      </SessionGate>,
    );
    await waitFor(() => expect(offline).toHaveBeenCalled());
    expect(screen.getByText('dashboard')).toBeTruthy();
    second.unmount();

    const never = vi.fn();
    render(
      <SessionGate health={client({ whoami: never })} bypass>
        <p>pair</p>
      </SessionGate>,
    );
    expect(screen.getByText('pair')).toBeTruthy();
    expect(never).not.toHaveBeenCalled();
  });
});
