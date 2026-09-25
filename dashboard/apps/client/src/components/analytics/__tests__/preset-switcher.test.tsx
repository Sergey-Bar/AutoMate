import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/test-utils';
import { PresetSwitcher } from '../PresetSwitcher';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PresetSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders nothing when feature flags endpoint returns non-ok status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'server error' }, 500));
    const { container } = renderWithProviders(<PresetSwitcher currentPreset="all" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading', () => {
    // Never resolve fetch so the query stays loading
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<PresetSwitcher currentPreset="all" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when role-based-views flag is false', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': false }));
    const { container } = renderWithProviders(<PresetSwitcher currentPreset="all" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const { container } = renderWithProviders(<PresetSwitcher currentPreset="all" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all preset buttons when role-based-views is enabled', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="all" />);

    expect(await screen.findByRole('button', { name: /All Metrics/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Developer$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /QA Lead/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Engineering Manager/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Product Manager/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Executive/i })).toBeInTheDocument();
  });

  it('highlights the currently active preset button', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="qa-lead" />);

    const qaLeadBtn = await screen.findByRole('button', { name: /QA Lead/i });
    // Active button has bg-bg-primary class
    expect(qaLeadBtn.className).toContain('bg-bg-primary');

    // Non-active button does not
    const allBtn = screen.getByRole('button', { name: /All Metrics/i });
    expect(allBtn.className).not.toContain('bg-bg-primary');
  });

  it('calls navigate and sets localStorage when a preset is clicked', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="all" />);

    const developerBtn = await screen.findByRole('button', { name: /^Developer$/i });
    await userEvent.click(developerBtn);

    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.any(Function) }),
    );
    expect(localStorage.getItem('analytics-preset')).toBe('developer');
  });

  it('calls navigate and updates localStorage for engineering-manager preset', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="all" />);

    const emBtn = await screen.findByRole('button', { name: /Engineering Manager/i });
    await userEvent.click(emBtn);

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('analytics-preset')).toBe('engineering-manager');
  });

  it('navigate search function spreads prev and sets new preset', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="all" />);

    const qaLeadBtn = await screen.findByRole('button', { name: /QA Lead/i });
    await userEvent.click(qaLeadBtn);

    const navigateCall = mocks.navigate.mock.calls[0][0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    const result = navigateCall.search({ days: 30 });
    expect(result).toEqual({ days: 30, preset: 'qa-lead' });
  });

  it('calls navigate and updates localStorage for pm preset', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="all" />);

    const pmBtn = await screen.findByRole('button', { name: /Product Manager/i });
    await userEvent.click(pmBtn);

    expect(localStorage.getItem('analytics-preset')).toBe('pm');
  });

  it('calls navigate and updates localStorage for executive preset', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ 'role-based-views': true }));
    renderWithProviders(<PresetSwitcher currentPreset="all" />);

    const execBtn = await screen.findByRole('button', { name: /Executive/i });
    await userEvent.click(execBtn);

    expect(localStorage.getItem('analytics-preset')).toBe('executive');
  });
});
