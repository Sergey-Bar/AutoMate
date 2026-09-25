import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, fireEvent, userEvent } from '@/test/test-utils';
import { AISettings } from '../AISettings';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AISettings dynamic providers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Default mock response: OpenAI
    fetchMock.mockResolvedValue(
      jsonResponse({ provider: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com', apiKey: 'sk....123' })
    );
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('ollama shows model + baseUrl but NOT apiKey', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434' }));
    renderWithProviders(<AISettings />);
    
    await screen.findByDisplayValue('llama3');
    
    expect(screen.getByText(/Model \*/)).toBeInTheDocument();
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument();
    expect(screen.queryByText(/API Key/)).not.toBeInTheDocument();
  });

  it('openai shows model + apiKey + baseUrl', async () => {
    renderWithProviders(<AISettings />);
    
    await screen.findByDisplayValue('gpt-4o');
    
    expect(screen.getByText(/Model \*/)).toBeInTheDocument();
    expect(screen.getByText(/API Key \*/)).toBeInTheDocument();
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument();
    expect(screen.queryByText(/API Version/)).not.toBeInTheDocument();
  });

  it('azure-openai shows model + apiKey + baseUrl + apiVersion', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ 
      provider: 'azure-openai', 
      model: 'gpt-4o', 
      baseUrl: 'https://my-resource.openai.azure.com', 
      apiKey: 'sk....123',
      apiVersion: '2024-02-01'
    }));
    renderWithProviders(<AISettings />);
    
    await screen.findByDisplayValue('2024-02-01');
    
    expect(screen.getByText(/Model \*/)).toBeInTheDocument();
    expect(screen.getByText(/API Key \*/)).toBeInTheDocument();
    expect(screen.getByText(/Endpoint URL \*/)).toBeInTheDocument();
    expect(screen.getByText(/API Version \*/)).toBeInTheDocument();
  });

  it('bedrock shows model + accessKeyId + secretAccessKey + region', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ 
      provider: 'bedrock', 
      model: 'anthropic.claude', 
      accessKeyId: 'AKIA123',
      secretAccessKey: 'hidden',
      region: 'us-east-1'
    }));
    renderWithProviders(<AISettings />);
    
    await screen.findByDisplayValue('AKIA123');
    
    expect(screen.getByText(/Model \*/)).toBeInTheDocument();
    expect(screen.getByText(/Access Key ID \*/)).toBeInTheDocument();
    expect(screen.getByText(/Secret Access Key \*/)).toBeInTheDocument();
    expect(screen.getByText(/Region \*/)).toBeInTheDocument();
    expect(screen.getByText('Session Token')).toBeInTheDocument(); // Optional
  });

  it('switching provider changes visible fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AISettings />);
    
    await screen.findByDisplayValue('gpt-4o');
    expect(screen.getByText(/API Key \*/)).toBeInTheDocument();
    
    // Switch to Ollama
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'ollama');
    
    expect(screen.queryByText(/API Key/)).not.toBeInTheDocument();
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument(); // not required for ollama
    
    // Switch to Azure
    await user.selectOptions(select, 'azure-openai');
    expect(screen.getByText(/API Version \*/)).toBeInTheDocument();
  });

  it('save submits correct discriminated union shape', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') {
        return jsonResponse({ provider: 'ollama', model: 'llama3' });
      }
      if (url === '/api/ai/config' && method === 'PUT') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });

    renderWithProviders(<AISettings />);
    await screen.findByDisplayValue('llama3');
    
    // Change to azure-openai and submit
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'azure-openai');
    
    // Need to fill required fields
    // Azure has: model, apiKey(password), baseUrl, apiVersion
    // Find by placeholder since there are multiple textboxes
    const modelInput = screen.getByPlaceholderText('gpt-4o');
    const baseUrlInput = screen.getByPlaceholderText('https://<resource>.openai.azure.com');
    const apiVersionInput = screen.getByPlaceholderText('2024-02-01');
    const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    
    await user.clear(modelInput);
    await user.type(modelInput, 'gpt-4o');
    await user.type(baseUrlInput, 'https://test.openai.azure.com');
    await user.type(apiVersionInput, '2024-02-01');
    await user.type(apiKeyInput, 'my-super-secret');
    
    await user.click(screen.getByRole('button', { name: 'Save' }));
    
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(c => c[0] === '/api/ai/config' && (c[1]?.method === 'PUT'));
      expect(putCall).toBeTruthy();
      const body = JSON.parse(String(putCall![1]?.body));
      expect(body).toEqual({
        provider: 'azure-openai',
        model: 'gpt-4o',
        baseUrl: 'https://test.openai.azure.com',
        apiVersion: '2024-02-01',
        apiKey: 'my-super-secret',
        dualAgentRca: false,
      });
    });
    
    expect(toast.success).toHaveBeenCalledWith('AI configuration saved');
  });

  it('preserves existing non-password config field when not modified', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/ai/config' && method === 'GET') {
        return jsonResponse({ provider: 'azure-openai', model: 'gpt-4o', baseUrl: 'https://test.openai.azure.com', apiVersion: '2024-02-01', apiKey: 'sk-1234' });
      }
      if (url === '/api/ai/config' && method === 'PUT') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });

    renderWithProviders(<AISettings />);
    // Wait for the data to load into the form
    await screen.findByDisplayValue('gpt-4o');
    await screen.findByDisplayValue('https://test.openai.azure.com');
    await screen.findByDisplayValue('2024-02-01');
    
    // the password field will show the dummy masked value from config or placeholder. Let's just clear the model field.
    const modelInput = screen.getByDisplayValue('gpt-4o');
    await user.clear(modelInput);
    
    await user.click(screen.getByRole('button', { name: 'Save' }));
    
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(c => c[0] === '/api/ai/config' && c[1]?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse(String(putCall![1]?.body));
      // It should fall back to config's model which is 'gpt-4o'
      expect(body.model).toBe('gpt-4o');
      // and it preserves other fields
      expect(body.baseUrl).toBe('https://test.openai.azure.com');
      expect(body.apiVersion).toBe('2024-02-01');
      expect(body.apiKey).toBe('sk-1234');
    });
  });
});
