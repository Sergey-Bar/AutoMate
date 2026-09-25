/// <reference types="@testing-library/jest-dom" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils';
import { toast } from 'sonner';
import { AISettings } from '../AISettings';
import { AuthSettings } from '../AuthSettings';
import { CategorySettings } from '../CategorySettings';
import { DisplaySettings } from '../DisplaySettings';
import { EmailSettings } from '../EmailSettings';
import { GeneralSettings } from '../GeneralSettings';
import { IntegrationSettings } from '../IntegrationSettings';
import { PRIntegrationSettings } from '../PRIntegrationSettings';
import { QualityGateSettings } from '../QualityGateSettings';
import { QuarantineSettings } from '../QuarantineSettings';
import { SchedulerSettings } from '../SchedulerSettings';
import { SettingsNav } from '../SettingsNav';
import { SettingRow, SettingsSection } from '../SettingsSection';
import { WebhookConfig } from '../WebhookConfig';
import { WorkspaceSettings } from '../WorkspaceSettings';
import { FeatureDisabledPage } from '../../shared/FeatureDisabledPage';

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');

  return {
    motion: new Proxy({}, {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
          const validTags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
          const Tag = typeof prop === 'string' && validTags.includes(prop) ? prop : 'div';
          return ReactModule.createElement(Tag, rest);
        };
      },
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
    useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
    useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
    useSpring: (v: unknown) => v,
  };
});

vi.mock('@tanstack/react-router', async () => {
  const ReactModule = await import('react');

  return {
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => ReactModule.createElement('a', { href: to, ...rest }, children),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ navigate: vi.fn() }),
    useSearch: () => ({}),
    useParams: () => ({}),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(jsonResponse({}));
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.warning).mockClear();
});

describe('SettingsSection', () => {
  it('renders section title and child content', () => {
    renderWithProviders(
      <SettingsSection title="Server Settings">
        <div>Child row</div>
      </SettingsSection>,
    );

    expect(screen.getByText('Server Settings')).toBeInTheDocument();
    expect(screen.getByText('Child row')).toBeInTheDocument();
  });

  it('renders setting row label, description, and control', () => {
    renderWithProviders(
      <SettingRow label="Email" description="SMTP recipient list">
        <button type="button">Configure</button>
      </SettingRow>,
    );

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('SMTP recipient list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
  });
});

describe('SettingsNav', () => {
  it('renders tab groups and representative tabs', () => {
    renderWithProviders(<SettingsNav activeTab="general" onTabChange={vi.fn()} />);

    expect(screen.getByText('General', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument();
    expect(screen.getByText('Integrations', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Webhooks' })).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Config' })).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument();
  });

  it('keeps post-MVP tabs visible while feature flags load', () => {
    renderWithProviders(<SettingsNav activeTab="general" onTabChange={vi.fn()} flags={{ 'ai-explain': false }} />);

    expect(screen.getByRole('button', { name: 'AI Config' })).toBeInTheDocument();
  });

  it('hides post-MVP tabs after feature flags load disabled', () => {
    renderWithProviders(
      <SettingsNav
        activeTab="general"
        onTabChange={vi.fn()}
        flags={{
          'scheduled-runs': false,
          'integration-hooks': false,
          'auto-quarantine': false,
          'ai-explain': false,
          'pr-comparison': false,
        }}
        flagsLoaded
      />,
    );

    expect(screen.queryByRole('button', { name: 'Scheduler' })).not.toBeInTheDocument();
    expect(screen.queryByText('Integrations', { selector: 'p' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auto-Quarantine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI Config' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quality Gate' })).toBeInTheDocument();
  });

  it('calls onTabChange with selected tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    renderWithProviders(<SettingsNav activeTab="general" onTabChange={onTabChange} flags={{ 'pr-comparison': true }} flagsLoaded />);

    await user.click(screen.getByRole('button', { name: 'PR Integration' }));
    expect(onTabChange).toHaveBeenCalledWith('pr-integration');
  });
});

describe('GeneralSettings', () => {
  it('renders default values', () => {
    renderWithProviders(<GeneralSettings />);

    expect(screen.getByDisplayValue('http://localhost:4000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('updates API URL and reporter port inputs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralSettings />);

    const inputs = screen.getAllByRole('textbox');
    await user.clear(inputs[0]);
    await user.type(inputs[0], 'https://example.local');
    await user.clear(inputs[1]);
    await user.type(inputs[1], '7777');

    expect(screen.getByDisplayValue('https://example.local')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7777')).toBeInTheDocument();
  });
});

describe('DisplaySettings', () => {
  it('renders two display toggles checked by default', () => {
    renderWithProviders(<DisplaySettings />);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(switches[0]).toHaveAttribute('aria-checked', 'true');
    expect(switches[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles animation switch off', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DisplaySettings />);

    const animationSwitch = screen.getAllByRole('switch')[0];
    await user.click(animationSwitch);

    expect(animationSwitch).toHaveAttribute('aria-checked', 'false');
  });
});

describe('AISettings', () => {
  it('loads config and displays populated model/endpoint values', async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') {
        return jsonResponse({ provider: 'ollama', apiKey: 'sk....1234', model: 'llama3', baseUrl: 'http://localhost:11434/v1/chat/completions' });
      }
      return jsonResponse({});
    });

    renderWithProviders(<AISettings />);

    expect(await screen.findByDisplayValue('llama3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://localhost:11434/v1/chat/completions')).toBeInTheDocument();
  });

  it('saves updated AI config', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') {
        return jsonResponse({ provider: 'openai', apiKey: 'sk....1234', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1/chat/completions' });
      }
      if (url === '/api/ai/config' && method === 'PUT') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    });

    renderWithProviders(<AISettings />);

    const modelInput = await screen.findByDisplayValue('gpt-4o');
    await user.clear(modelInput);
    await user.type(modelInput, 'gpt-4.1-mini');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ai/config',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    const putCall = mockFetch.mock.calls.find((call) => call[0] === '/api/ai/config' && (call[1]?.method ?? 'GET') === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall?.[1]?.body));
    expect(body.model).toBe('gpt-4.1-mini');
    expect(toast.success).toHaveBeenCalledWith('AI configuration saved');
  });

  it('tests AI connection and shows response', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') {
        return jsonResponse({ provider: 'openai', apiKey: 'sk....1234', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1/chat/completions' });
      }
      if (url === '/api/ai/explain' && method === 'POST') {
        return jsonResponse({ summary: 'Likely assertion mismatch', suggestion: 'Check expected boolean', confidence: 0.92 });
      }
      return jsonResponse({});
    });

    renderWithProviders(<AISettings />);
    await user.click(await screen.findByRole('button', { name: 'Test' }));

    expect(await screen.findByText(/AI Response:/)).toBeInTheDocument();
    expect(screen.getByText(/Likely assertion mismatch/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('AI connection works!');
  });

  it('shows error toast when AI test fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') return jsonResponse({});
      if (url === '/api/ai/explain' && method === 'POST') return jsonResponse({ error: 'API key invalid' }, 401);
      return jsonResponse({});
    });
    renderWithProviders(<AISettings />);
    await user.click(await screen.findByRole('button', { name: 'Test' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('API key invalid');
    });
  });

  it('shows error toast when AI save fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') return jsonResponse({ provider: 'openai', model: 'gpt-4o', baseUrl: '' });
      if (url === '/api/ai/config' && method === 'PUT') return jsonResponse({ error: 'server error' }, 500);
      return jsonResponse({});
    });
    renderWithProviders(<AISettings />);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save AI config');
    });
  });

  it('allows changing provider selection', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(jsonResponse({}));
    renderWithProviders(<AISettings />);
    await screen.findByRole('button', { name: 'Save' });
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'ollama');
    expect((select as HTMLSelectElement).value).toBe('ollama');
  });
});

describe('CategorySettings', () => {
  it('renders fetched categories', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/categories') {
        return jsonResponse([
          { id: 'cat-1', name: 'Regression', color: '#ef4444' },
          { id: 'cat-2', name: 'Flaky', color: '#eab308' },
        ]);
      }
      return jsonResponse({});
    });

    renderWithProviders(<CategorySettings />);

    expect(await screen.findByText('Regression')).toBeInTheDocument();
    expect(screen.getByText('Flaky')).toBeInTheDocument();
  });

  it('creates a category and clears name input', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/categories' && method === 'GET') return jsonResponse([]);
      if (url === '/api/categories' && method === 'POST') return jsonResponse({ id: 'new-cat' }, 201);
      return jsonResponse({});
    });

    renderWithProviders(<CategorySettings />);

    const nameInput = screen.getByPlaceholderText('Category name…');
    await user.type(nameInput, 'Perf');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/categories', expect.objectContaining({ method: 'POST' }));
    });
    expect(nameInput).toHaveValue('');
    expect(toast.success).toHaveBeenCalledWith('Category created');
  });

  it('deletes an existing category', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/categories' && method === 'GET') {
        return jsonResponse([{ id: 'cat-9', name: 'Security', color: '#22c55e' }]);
      }
      if (url === '/api/categories/cat-9' && method === 'DELETE') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<CategorySettings />);
    await user.click(await screen.findByRole('button', { name: 'Delete Security' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/categories/cat-9', expect.objectContaining({ method: 'DELETE' }));
    });
  });
});

describe('EmailSettings', () => {
  it('loads email config into form fields', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/integrations/config') {
        return jsonResponse({
          email: {
            host: 'smtp.example.com',
            port: 2525,
            secure: true,
            user: 'qa@example.com',
            pass: '••••••••',
            recipients: ['dev@example.com', 'qa@example.com'],
            enabled: false,
          },
        });
      }
      return jsonResponse({});
    });

    renderWithProviders(<EmailSettings />);

    expect(await screen.findByDisplayValue('smtp.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2525')).toBeInTheDocument();
    expect(screen.getByDisplayValue('qa@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('dev@example.com, qa@example.com')).toBeInTheDocument();
  });

  it('saves edited email config with parsed recipients', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ email: {} });
      if (url === '/api/integrations/config' && method === 'PUT') return jsonResponse({ ok: true });
      return jsonResponse({});
    });

    renderWithProviders(<EmailSettings />);

    await user.type(await screen.findByPlaceholderText('smtp.example.com'), 'smtp.mail.local');
    await user.clear(screen.getByPlaceholderText('587'));
    await user.type(screen.getByPlaceholderText('587'), '1025');
    await user.type(screen.getByPlaceholderText('qa@company.com, dev@company.com'), 'qa@acme.test, dev@acme.test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/config', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = mockFetch.mock.calls.find((call) => call[0] === '/api/integrations/config' && (call[1]?.method ?? 'GET') === 'PUT');
    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.email.host).toBe('smtp.mail.local');
    expect(payload.email.port).toBe(1025);
    expect(payload.email.recipients).toEqual(['qa@acme.test', 'dev@acme.test']);
    expect(toast.success).toHaveBeenCalledWith('Email config saved');
  });

  it('shows toast error when test email request fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ email: {} });
      if (url === '/api/integrations/test/email' && method === 'POST') return jsonResponse({ error: 'failed' }, 500);
      return jsonResponse({});
    });

    renderWithProviders(<EmailSettings />);
    await user.click(await screen.findByRole('button', { name: 'Send Test' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Email test failed — check SMTP settings');
    });
  });
});

describe('IntegrationSettings', () => {
  it('saves Slack webhook config', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({});
      if (url === '/api/integrations/config' && method === 'PUT') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<IntegrationSettings />);

    const slackInput = await screen.findByPlaceholderText('https://hooks.slack.com/services/…');
    await user.type(slackInput, 'https://hooks.slack.com/services/T1/B1/KEY');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/config', expect.objectContaining({ method: 'PUT' }));
    });
    expect(toast.success).toHaveBeenCalledWith('Integration config saved');
  });

  it('shows toast error when Slack test fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({});
      if (url === '/api/integrations/test/slack' && method === 'POST') return jsonResponse({ error: 'bad webhook' }, 500);
      return jsonResponse({});
    });

    renderWithProviders(<IntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Slack test failed — check webhook URL');
    });
  });

  it('tests GitHub connection successfully', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({});
      if (url === '/api/integrations/test/github' && method === 'POST') return jsonResponse({ repo: 'acme/dashboard' });
      return jsonResponse({});
    });

    renderWithProviders(<IntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Connected to acme/dashboard');
    });
  });

  it('shows error toast when save fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({});
      if (url === '/api/integrations/config' && method === 'PUT') throw new Error('Network error');
      return jsonResponse({});
    });

    renderWithProviders(<IntegrationSettings />);
    await user.click((await screen.findAllByRole('button', { name: 'Save' }))[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save');
    });
  });

  it('shows error toast when GitHub test connection fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({});
      if (url === '/api/integrations/test/github' && method === 'POST') return jsonResponse({ error: 'unauthorized' }, 401);
      return jsonResponse({});
    });

    renderWithProviders(<IntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('GitHub test failed — check token and repo');
    });
  });
});

describe('PRIntegrationSettings', () => {
  it('saves PR integration settings payload', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ github: {} });
      if (url === '/api/integrations/config' && method === 'PUT') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<PRIntegrationSettings />);

    const [tokenInput, ownerInput, repoInput] = await screen.findAllByPlaceholderText(/ghp_…|Owner|Repo/);
    await user.type(tokenInput, 'ghp_test123');
    await user.type(ownerInput, 'acme');
    await user.type(repoInput, 'dashboard');
    await user.type(screen.getByPlaceholderText('main'), 'release/main');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/config', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = mockFetch.mock.calls.find((call) => call[0] === '/api/integrations/config' && (call[1]?.method ?? 'GET') === 'PUT');
    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.github.owner).toBe('acme');
    expect(payload.github.repo).toBe('dashboard');
    expect(payload.github.defaultBaseBranch).toBe('release/main');
    expect(toast.success).toHaveBeenCalledWith('PR integration config saved');
  });

  it('saves PR integration settings with undefined when fields are empty', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ github: {} });
      if (url === '/api/integrations/config' && method === 'PUT') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<PRIntegrationSettings />);

    await screen.findAllByPlaceholderText(/ghp_…|Owner|Repo/);
    
    // Do not type anything, just save
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/config', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = mockFetch.mock.calls.find((call) => call[0] === '/api/integrations/config' && (call[1]?.method ?? 'GET') === 'PUT');
    const payload = JSON.parse(String(putCall?.[1]?.body));
    
    // Assert undefined fields are stripped out by JSON.stringify
    expect(payload.github).not.toHaveProperty('token');
    expect(payload.github).not.toHaveProperty('owner');
    expect(payload.github).not.toHaveProperty('repo');
    expect(payload.github).not.toHaveProperty('defaultBaseBranch');
    
    expect(payload.github.enabled).toBe(true);
    expect(payload.github.prComments).toBe(true);
  });

  it('tests GitHub connection', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ github: {} });
      if (url === '/api/integrations/test/github' && method === 'POST') return jsonResponse({ repo: 'acme/dashboard' });
      return jsonResponse({});
    });

    renderWithProviders(<PRIntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Connected to acme/dashboard');
    });
  });

  it('toggles PR options switches', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(jsonResponse({ github: { defaultBaseBranch: 'develop', token: 'some_token', owner: 'abc', repo: 'def' } }));

    renderWithProviders(<PRIntegrationSettings />);

    const switches = await screen.findAllByRole('switch');
    expect(switches[0]).toHaveAttribute('aria-checked', 'true');
    await user.click(switches[1]);
    expect(switches[1]).toHaveAttribute('aria-checked', 'true');
    await user.click(switches[2]);
    expect(switches[2]).toHaveAttribute('aria-checked', 'true');
    
    // Also check the placeholder branches loaded from config
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('abc')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('def')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('develop')).toBeInTheDocument();
  });

  it('shows error toast when save fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ github: {} });
      if (url === '/api/integrations/config' && method === 'PUT') throw new Error('Network error');
      return jsonResponse({});
    });

    renderWithProviders(<PRIntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save');
    });
  });

  it('shows error toast when GitHub test connection fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/config' && method === 'GET') return jsonResponse({ github: {} });
      if (url === '/api/integrations/test/github' && method === 'POST') return jsonResponse({ error: 'unauthorized' }, 401);
      return jsonResponse({});
    });

    renderWithProviders(<PRIntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('GitHub test failed — check token and repo');
    });
  });
});

describe('QualityGateSettings', () => {
  it('loads gate settings values', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/gate-config') {
        return jsonResponse({ passRateThreshold: 95, maxDurationMs: 90000, maxFlakyCount: 2 });
      }
      return jsonResponse({});
    });

    renderWithProviders(<QualityGateSettings />);

    expect(await screen.findByDisplayValue('95')).toBeInTheDocument();
    expect(screen.getByDisplayValue('90000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('saves quality gate with null optional limits', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/gate-config' && method === 'GET') return jsonResponse({ passRateThreshold: 100, maxDurationMs: null, maxFlakyCount: null });
      if (url === '/api/gate-config' && method === 'PUT') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<QualityGateSettings />);

    const thresholdInput = await screen.findByDisplayValue('100');
    await user.click(thresholdInput);
    await user.keyboard('{Control>}a{/Control}98');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const putCall = await waitFor(() => {
      const call = mockFetch.mock.calls.find((c) => c[0] === '/api/gate-config' && (c[1]?.method ?? 'GET') === 'PUT');
      expect(call).toBeTruthy();
      return call;
    });

    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.passRateThreshold).toBe(98);
    expect(payload.maxDurationMs).toBeNull();
    expect(payload.maxFlakyCount).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Quality gate saved');
  });
});

describe('QuarantineSettings', () => {
  it('loads auto-quarantine values', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/auto-quarantine') {
        return jsonResponse({ flakyThreshold: 4, lookbackRuns: 20 });
      }
      return jsonResponse({});
    });

    renderWithProviders(<QuarantineSettings />);

    expect(await screen.findByDisplayValue('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
  });

  it('saves updated auto-quarantine values', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/auto-quarantine' && method === 'GET') return jsonResponse({ flakyThreshold: 3, lookbackRuns: 10 });
      if (url === '/api/settings/auto-quarantine' && method === 'PUT') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<QuarantineSettings />);

    const flakyInput = await screen.findByDisplayValue('3');
    const lookbackInput = screen.getByDisplayValue('10');
    await user.click(flakyInput);
    await user.keyboard('{Control>}a{/Control}5');
    await user.click(lookbackInput);
    await user.keyboard('{Control>}a{/Control}30');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const putCall = mockFetch.mock.calls.find((c) => c[0] === '/api/settings/auto-quarantine' && (c[1]?.method ?? 'GET') === 'PUT');
    expect(putCall).toBeTruthy();
    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload).toEqual({ flakyThreshold: 5, lookbackRuns: 30 });
    expect(toast.success).toHaveBeenCalledWith('Auto-quarantine settings saved');
  });
});

describe('SchedulerSettings', () => {
  it('renders existing schedule row', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/schedules') {
        return jsonResponse([{ id: 's1', cronExpr: '*/30 * * * *', enabled: true }]);
      }
      return jsonResponse({});
    });

    renderWithProviders(<SchedulerSettings />);

    expect(await screen.findByText('*/30 * * * *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete schedule' })).toBeInTheDocument();
  });

  it('adds new schedule using Add button', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/schedules' && method === 'GET') return jsonResponse([]);
      if (url === '/api/schedules' && method === 'POST') return jsonResponse({ id: 's2' }, 201);
      return jsonResponse({});
    });

    renderWithProviders(<SchedulerSettings />);
    await user.type(await screen.findByPlaceholderText('*/30 * * * * (cron expression)'), '0 * * * *');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/schedules', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('toggles and deletes schedule', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/schedules' && method === 'GET') return jsonResponse([{ id: 's3', cronExpr: '15 * * * *', enabled: false }]);
      if (url === '/api/schedules/s3' && method === 'PUT') return jsonResponse({});
      if (url === '/api/schedules/s3' && method === 'DELETE') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<SchedulerSettings />);
    const switchEl = await screen.findByRole('switch');
    await user.click(switchEl);
    await user.click(screen.getByRole('button', { name: 'Delete schedule' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/schedules/s3', expect.objectContaining({ method: 'PUT' }));
      expect(mockFetch).toHaveBeenCalledWith('/api/schedules/s3', expect.objectContaining({ method: 'DELETE' }));
    });
  });
});

describe('WebhookConfig', () => {
  it('renders empty-state message when no webhooks', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/integrations/webhooks') return jsonResponse([]);
      return jsonResponse({});
    });

    renderWithProviders(<WebhookConfig />);

    expect(await screen.findByText('No webhooks configured')).toBeInTheDocument();
  });

  it('adds a webhook with selected events', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/webhooks' && method === 'GET') return jsonResponse([]);
      if (url === '/api/integrations/webhooks' && method === 'POST') return jsonResponse({}, 201);
      return jsonResponse({});
    });

    renderWithProviders(<WebhookConfig />);

    await user.type(await screen.findByPlaceholderText('https://your-webhook-endpoint.com/hook'), 'https://hooks.example.com/a');
    await user.click(screen.getByRole('button', { name: 'run:end' }));
    await user.click(screen.getByRole('button', { name: 'Add Webhook' }));

    const postCall = mockFetch.mock.calls.find((c) => c[0] === '/api/integrations/webhooks' && (c[1]?.method ?? 'GET') === 'POST');
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.[1]?.body));
    expect(payload.url).toBe('https://hooks.example.com/a');
    expect(payload.events).toEqual(['run:end']);
  });

  it('tests and deletes existing webhook', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/webhooks' && method === 'GET') {
        return jsonResponse([{ url: 'https://hooks.example.com/x', events: ['run:end', 'gate:fail'] }]);
      }
      if (url === '/api/integrations/webhooks/test' && method === 'POST') return jsonResponse({ ok: true });
      if (url === '/api/integrations/webhooks/0' && method === 'DELETE') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<WebhookConfig />);
    await user.click(await screen.findByRole('button', { name: 'Test' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/webhooks/test', expect.objectContaining({ method: 'POST' }));
      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/webhooks/0', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  it('resets testing state when test webhook fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/integrations/webhooks' && method === 'GET') {
        return jsonResponse([{ url: 'https://hooks.example.com/fail', events: ['run:end'] }]);
      }
      if (url === '/api/integrations/webhooks/test' && method === 'POST') return jsonResponse({ error: 'connection refused' }, 500);
      return jsonResponse({});
    });
    renderWithProviders(<WebhookConfig />);
    await user.click(await screen.findByRole('button', { name: 'Test' }));
    await waitFor(() => {
      expect(screen.queryByText('Testing...')).toBeNull();
    });
  });
});

describe('WorkspaceSettings', () => {
  it('renders existing workspaces', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/workspaces') {
        return jsonResponse([{ id: 'w1', name: 'Main', configPath: '/repo/playwright.config.ts', createdAt: '2026-03-01T00:00:00.000Z' }]);
      }
      return jsonResponse({});
    });

    renderWithProviders(<WorkspaceSettings />);

    expect(await screen.findByText('Main')).toBeInTheDocument();
    expect(screen.getByText('/repo/playwright.config.ts')).toBeInTheDocument();
  });

  it('creates workspace and clears form', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/workspaces' && method === 'GET') return jsonResponse([]);
      if (url === '/api/workspaces' && method === 'POST') return jsonResponse({ id: 'w2' }, 201);
      return jsonResponse({});
    });

    renderWithProviders(<WorkspaceSettings />);

    const nameInput = await screen.findByPlaceholderText('Workspace name');
    const pathInput = screen.getByPlaceholderText('playwright.config.ts path');
    await user.type(nameInput, 'E2E Suite');
    await user.type(pathInput, '/repo/e2e/playwright.config.ts');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({ method: 'POST' }));
    });
    expect(nameInput).toHaveValue('');
    expect(pathInput).toHaveValue('');
    expect(toast.success).toHaveBeenCalledWith('Workspace created');
  });

  it('deletes workspace', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/workspaces' && method === 'GET') {
        return jsonResponse([{ id: 'w3', name: 'Legacy', configPath: '/legacy/playwright.config.ts', createdAt: '2026-03-01T00:00:00.000Z' }]);
      }
      if (url === '/api/workspaces/w3' && method === 'DELETE') return jsonResponse({});
      return jsonResponse({});
    });

    renderWithProviders(<WorkspaceSettings />);

    await user.click(await screen.findByRole('button', { name: 'Delete workspace' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/w3', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(toast.success).toHaveBeenCalledWith('Workspace deleted');
  });
});

describe('AuthSettings', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders disabled auth warning when auth is disabled', async () => {
    mockFetch.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: false, keyCount: 0 }));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.queryByText('API is publicly accessible. Enable authentication to secure your instance.')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Enable Auth' })).not.toBeNull();
  });

  it('renders enabled auth status with key count and disable button', async () => {
    mockFetch.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 2 }));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.queryByText('Authentication is active. All API requests require a valid bearer token.')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Disable Auth' })).not.toBeNull();
    expect(screen.queryByText('2 API keys configured')).not.toBeNull();
  });

  it('renders API keys list with name and key preview', async () => {
    const keys = [
      { id: 'k1', name: 'CI Pipeline', keyPreview: 'sk-***1234', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-03-01T10:00:00.000Z' },
      { id: 'k2', name: 'Local Dev', keyPreview: 'sk-***5678', createdAt: '2026-02-01T00:00:00.000Z', lastUsedAt: null },
    ];
    mockFetch.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 2 }));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse(keys));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);

    await waitFor(() => expect(screen.queryByText('CI Pipeline')).not.toBeNull());
    expect(screen.queryByText('sk-***1234')).not.toBeNull();
    expect(screen.queryByText('Local Dev')).not.toBeNull();
    expect(screen.queryByText('sk-***5678')).not.toBeNull();
  });

  it('shows generated key after successful key generation', async () => {
    const user = userEvent.setup();
    const generatedKey = { id: 'k3', name: 'New Key', keyPreview: 'sk-***abcd', key: 'sk-full-secret-key', createdAt: '2026-03-27T00:00:00.000Z', lastUsedAt: null };

    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 1 }));
      if (url.includes('/api/auth/keys') && init?.method === 'POST') return Promise.resolve(jsonResponse(generatedKey));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByText('Authentication')).not.toBeNull());

    const nameInput = screen.getByPlaceholderText('Key name (e.g. CI Pipeline)');
    await user.type(nameInput, 'New Key');
    await user.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(screen.queryByText('sk-full-secret-key')).not.toBeNull());
    expect(toast.success).toHaveBeenCalledWith('API key generated');
  });

  it('copies newly generated key to clipboard', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const generatedKey = { id: 'k3', name: 'Clipboard Key', keyPreview: 'sk-***xyz', key: 'sk-clipboard-key', createdAt: '2026-03-27T00:00:00.000Z', lastUsedAt: null };

    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 1 }));
      if (url.includes('/api/auth/keys') && init?.method === 'POST') return Promise.resolve(jsonResponse(generatedKey));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByText('Authentication')).not.toBeNull());

    const nameInput = screen.getByPlaceholderText('Key name (e.g. CI Pipeline)');
    await user.type(nameInput, 'Clipboard Key');
    await user.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(screen.queryByText('sk-clipboard-key')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /Copy/i }));
    expect(writeTextSpy).toHaveBeenCalledWith('sk-clipboard-key');
    expect(toast.success).toHaveBeenCalledWith('API key copied to clipboard');
    writeTextSpy.mockRestore();
  });

  it('generates key on Enter keypress in name input', async () => {
    const user = userEvent.setup();
    const generatedKey = { id: 'k4', name: 'Enter Key', keyPreview: 'sk-***enter', key: 'sk-enter-key', createdAt: '2026-03-27T00:00:00.000Z', lastUsedAt: null };

    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: false, keyCount: 0 }));
      if (url.includes('/api/auth/keys') && init?.method === 'POST') return Promise.resolve(jsonResponse(generatedKey));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    const nameInput = screen.getByPlaceholderText('Key name (e.g. CI Pipeline)');
    await user.type(nameInput, 'Enter Key{Enter}');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('API key generated'));
  });

  it('deletes an API key and shows success toast', async () => {
    const user = userEvent.setup();
    const keys = [{ id: 'k-del', name: 'Old Key', keyPreview: 'sk-***del', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }];

    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 1 }));
      if (url.includes('/api/auth/keys/k-del') && init?.method === 'DELETE') return Promise.resolve(jsonResponse({}));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse(keys));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByText('Old Key')).not.toBeNull());

    // Find delete button (ghost button with Trash icon, no text)
    const deleteBtn = screen.getAllByRole('button').find((btn) => !btn.textContent?.trim() && btn.querySelector('svg'));
    expect(deleteBtn).toBeTruthy();
    await user.click(deleteBtn!);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('API key revoked'));
  });

  it('toggles auth enabled state and shows toast', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: false, keyCount: 0 }));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/auth/enable') && init?.method === 'PUT') return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable Auth' })).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Enable Auth' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('shows empty keys message when no keys configured', async () => {
    mockFetch.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: false, keyCount: 0 }));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByText('No API keys configured. Generate one to get started.')).not.toBeNull());
  });
  it('shows error toast when toggle auth fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: false, keyCount: 0 }));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/auth/enable') && init?.method === 'PUT') return Promise.reject(new Error('Network error'));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable Auth' })).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Enable Auth' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update authentication'));
  });

  it('shows error toast when generate key fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 1 }));
      if (url.includes('/api/auth/keys') && init?.method === 'POST') return Promise.resolve(jsonResponse({ error: 'Server error' }, 500));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByText('Authentication')).not.toBeNull());

    const nameInput = screen.getByPlaceholderText('Key name (e.g. CI Pipeline)');
    await user.type(nameInput, 'Failed Key');
    await user.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to generate API key'));
  });

  it('shows error toast when delete key fails', async () => {
    const user = userEvent.setup();
    const keys = [{ id: 'k-del-fail', name: 'Old Key', keyPreview: 'sk-***del', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }];

    mockFetch.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) return Promise.resolve(jsonResponse({ enabled: true, keyCount: 1 }));
      if (url.includes('/api/auth/keys/k-del-fail') && init?.method === 'DELETE') return Promise.resolve(jsonResponse({ error: 'Server error' }, 500));
      if (url.includes('/api/auth/keys')) return Promise.resolve(jsonResponse(keys));
      return Promise.resolve(jsonResponse({}));
    });

    renderWithProviders(<AuthSettings />);
    await waitFor(() => expect(screen.queryByText('Old Key')).not.toBeNull());

    const deleteBtn = screen.getAllByRole('button').find((btn) => !btn.textContent?.trim() && btn.querySelector('svg'));
    await user.click(deleteBtn!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to revoke API key'));
  });
});

describe('FeatureDisabledPage', () => {
  it('renders feature name and disabled message', () => {
    renderWithProviders(<FeatureDisabledPage feature="AI Explain" />);
    expect(screen.queryByText('AI Explain is not enabled')).not.toBeNull();
    expect(screen.queryByText(/This feature is currently disabled/)).not.toBeNull();
  });

  it('renders Lock icon container', () => {
    const { container } = renderWithProviders(<FeatureDisabledPage feature="Codegen" />);
    // Lock icon is rendered inside a div with rounded-full styling
    const iconContainer = container.querySelector('.rounded-full');
    expect(iconContainer).not.toBeNull();
  });

  it('renders different feature names correctly', () => {
    const { rerender } = renderWithProviders(<FeatureDisabledPage feature="Auto Quarantine" />);
    expect(screen.queryByText('Auto Quarantine is not enabled')).not.toBeNull();

    rerender(<FeatureDisabledPage feature="Scheduled Runs" />);
    expect(screen.queryByText('Scheduled Runs is not enabled')).not.toBeNull();
  });
});
