/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { AnyRootRoute } from '@tanstack/react-router';
import { Route as settingsRoute, parseFiniteTemperatureInput } from './settings.js';
import { defaultApiClient } from '../lib/api.js';
import type { ModelConfig } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  defaultApiClient: {
    getModelConfig: vi.fn(),
    updateModelConfig: vi.fn(),
  }
}));

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

describe('Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderRoute = () => {
    const rootRoute = createRootRoute({});
    const testRoute = settingsRoute;
    testRoute.options.getParentRoute = () => rootRoute as AnyRootRoute;
    rootRoute.addChildren([testRoute]);
    
    const history = createMemoryHistory({
      initialEntries: ['/settings'],
    });
    
    const router = createRouter({
      routeTree: rootRoute,
      history,
    });
    
    return render(<RouterProvider router={router} />);
  };

  it('renders config', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
      expect(screen.getByTestId('model-input')).toHaveValue('llama3.1');
    });
    
    expect(screen.getByTestId('temperature-input')).toHaveValue(0.7);
  });

  it('displays error message when fetching config fails', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockRejectedValue(new Error('Fetch error'));
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('Fetch error')).toBeInTheDocument();
    });
  });

  it('allows updating model config and shows success message', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });
    vi.mocked(defaultApiClient.updateModelConfig).mockResolvedValue({ model: 'gpt-4', temperature: 0.9 });
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByTestId('model-input')).toBeInTheDocument();
    });

    const modelInput = screen.getByTestId('model-input');
    const tempInput = screen.getByTestId('temperature-input');
    const saveButton = screen.getByTestId('save-settings');

    fireEvent.change(modelInput, { target: { value: 'gpt-4' } });
    fireEvent.change(tempInput, { target: { value: '0.9' } });
    
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(defaultApiClient.updateModelConfig).toHaveBeenCalledWith({ model: 'gpt-4', temperature: 0.9 });
    });

    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
      expect(screen.getByTestId('model-input')).toHaveValue('gpt-4');
    });
  });

  it('displays error when saving fails', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });
    vi.mocked(defaultApiClient.updateModelConfig).mockRejectedValue(new Error('Save failed'));
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByTestId('model-input')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('save-settings'));

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });
  });

  it('blocks invalid finite-number values before save', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('temperature-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('temperature-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('save-settings'));

    await waitFor(() => {
      expect(screen.getByText('Temperature must be a valid number between 0 and 2')).toBeInTheDocument();
    });

    expect(defaultApiClient.updateModelConfig).not.toHaveBeenCalled();
  });

  it('parses only finite temperature inputs', () => {
    expect(parseFiniteTemperatureInput('')).toBeNull();
    expect(parseFiniteTemperatureInput('Infinity')).toBeNull();
    expect(parseFiniteTemperatureInput('-Infinity')).toBeNull();
    expect(parseFiniteTemperatureInput('NaN')).toBeNull();
    expect(parseFiniteTemperatureInput('0.7')).toBe(0.7);
    expect(parseFiniteTemperatureInput('2')).toBe(2);
  });

  it('blocks empty temperature input before save', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('temperature-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('temperature-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('save-settings'));

    await waitFor(() => {
      expect(screen.getByText('Temperature must be a valid number between 0 and 2')).toBeInTheDocument();
    });

    expect(defaultApiClient.updateModelConfig).not.toHaveBeenCalled();
  });

  it('keeps valid temperature values editable', async () => {
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('temperature-input')).toBeInTheDocument();
    });

    const temperatureInput = screen.getByTestId('temperature-input');
    fireEvent.change(temperatureInput, { target: { value: '0' } });
    fireEvent.change(temperatureInput, { target: { value: '2' } });
    fireEvent.change(temperatureInput, { target: { value: '0.7' } });

    fireEvent.click(screen.getByTestId('save-settings'));

    await waitFor(() => {
      expect(defaultApiClient.updateModelConfig).toHaveBeenCalledWith({ model: 'llama3.1', temperature: 0.7 });
    });
  });

  it('disables save button while saving', async () => {
    let resolveSave: (value: ModelConfig) => void;
    vi.mocked(defaultApiClient.getModelConfig).mockResolvedValue({ model: 'llama3.1', temperature: 0.7 });
    vi.mocked(defaultApiClient.updateModelConfig).mockReturnValue(new Promise(res => { resolveSave = res; }));
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByTestId('save-settings')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('save-settings'));

    await waitFor(() => {
      expect(screen.getByTestId('save-settings')).toBeDisabled();
      expect(screen.getByTestId('save-settings')).toHaveTextContent('Saving...');
    });

    resolveSave!({ model: 'llama3.1', temperature: 0.7 });

    await waitFor(() => {
      expect(screen.getByTestId('save-settings')).not.toBeDisabled();
    });
  });
});
