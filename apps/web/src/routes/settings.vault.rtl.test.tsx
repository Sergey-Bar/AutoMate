/**
 * settings.vault.rtl.test.tsx
 *
 * RTL tests for VaultSettingsPage focusing on interaction paths not covered by
 * the SSR-based tests. Specifically:
 *  - handleLock: clicking "Lock Vault" calls POST /api/vault/lock and sets
 *    isUnlocked=false (lines 70-72)
 *  - Credential sections shown when vault is unlocked with connectors
 */
import { render, screen, fireEvent, waitFor, act } from '../test/test-utils.js';
import { VaultSettingsPage } from './settings.vault.js';

describe('VaultSettingsPage RTL — vault unlock and lock flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders locked state with password input and Unlock Vault button', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch; // never resolves
    render(<VaultSettingsPage />);

    expect(screen.getByText('Vault Settings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Master password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock Vault' })).toBeInTheDocument();
  });

  it('Unlock Vault button is disabled when password field is empty', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch;
    render(<VaultSettingsPage />);

    expect(screen.getByRole('button', { name: 'Unlock Vault' })).toBeDisabled();
  });

  it('Unlock Vault button becomes enabled after typing password', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch;
    render(<VaultSettingsPage />);

    const passwordInput = screen.getByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    });

    expect(screen.getByRole('button', { name: 'Unlock Vault' })).toBeEnabled();
  });

  it('successful unlock shows Lock Vault button and hides Unlock form — covers handleLock path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) })  // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => [] })                         // loadConnectors
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });                      // handleUnlock POST

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    render(<VaultSettingsPage />);

    const passwordInput = await screen.findByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } });
    });

    const unlockBtn = screen.getByRole('button', { name: 'Unlock Vault' });
    await act(async () => {
      fireEvent.click(unlockBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lock Vault' })).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('Master password')).not.toBeInTheDocument();
  });

  it('Lock Vault button click calls POST /api/vault/lock and returns to locked state — covers lines 70-72', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) })  // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => [] })                         // loadConnectors
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })                       // handleUnlock
      .mockResolvedValueOnce({ ok: true });                                               // handleLock

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    render(<VaultSettingsPage />);

    const passwordInput = await screen.findByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lock Vault' })).toBeInTheDocument();
    });

    // Click Lock Vault — covers handleLock body (lines 70-72)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lock Vault' }));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Master password')).toBeInTheDocument();
    });

    // Verify the POST /api/vault/lock call was made
    expect(fetchMock).toHaveBeenCalledWith('/api/vault/lock', { method: 'POST' });
  });

  it('shows error message when unlock request fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) }) // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => [] })                        // loadConnectors
      .mockResolvedValueOnce({                                                           // handleUnlock fails
        ok: false,
        status: 401,
        json: async () => ({ error: 'Wrong password' }),
      });

    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    render(<VaultSettingsPage />);

    const passwordInput = await screen.findByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'wrongpass' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Wrong password')).toBeInTheDocument();
    });
  });

  it('shows Unlocking... label while unlock request is pending', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) }) // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => [] })                        // loadConnectors
      .mockReturnValueOnce(new Promise(() => {}));                                       // handleUnlock never resolves

    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    render(<VaultSettingsPage />);

    const passwordInput = await screen.findByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    });

    expect(screen.getByRole('button', { name: 'Unlocking...' })).toBeInTheDocument();
  });

  it('Enter key in password field triggers unlock', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) }) // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => [] })                        // loadConnectors
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });                     // handleUnlock

    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    render(<VaultSettingsPage />);

    const passwordInput = await screen.findByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } });
      fireEvent.keyDown(passwordInput, { key: 'Enter' });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lock Vault' })).toBeInTheDocument();
    });
  });

  it('connector credential section renders when unlocked with connectors', async () => {
    const connectors = [
      { name: 'github', displayName: 'GitHub', description: 'GitHub connector', icon: '🐙', toolCount: 3 },
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) }) // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => connectors })               // loadConnectors
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });                    // handleUnlock

    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    render(<VaultSettingsPage />);

    const passwordInput = await screen.findByPlaceholderText('Master password');
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock Vault' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Connector Credentials')).toBeInTheDocument();
    });

    expect(screen.getByText('🐙 GitHub')).toBeInTheDocument();
  });
});
