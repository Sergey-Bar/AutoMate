/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PromptInput } from './PromptInput.js';

describe('PromptInput', () => {
  it('renders textarea and submit button', () => {
    render(<PromptInput onSubmit={vi.fn()} />);
    expect(screen.getByTestId('prompt-input')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-submit')).toBeInTheDocument();
  });

  it('submit button is disabled when textarea is empty', () => {
    render(<PromptInput onSubmit={vi.fn()} />);
    expect(screen.getByTestId('prompt-submit')).toBeDisabled();
  });

  it('submit button is enabled when textarea has text', () => {
    render(<PromptInput onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: 'Go to google.com' } });
    expect(screen.getByTestId('prompt-submit')).not.toBeDisabled();
  });

  it('calls onSubmit with trimmed value when Run is clicked', () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: '  navigate to example.com  ' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    expect(onSubmit).toHaveBeenCalledWith('navigate to example.com');
  });

  it('clears textarea after submission', () => {
    render(<PromptInput onSubmit={vi.fn()} />);
    const textarea = screen.getByTestId('prompt-textarea');
    fireEvent.change(textarea, { target: { value: 'do something' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    expect(textarea).toHaveValue('');
  });

  it('does not call onSubmit when value is only whitespace', () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows loading state when isLoading is true', () => {
    render(<PromptInput onSubmit={vi.fn()} isLoading={true} />);
    expect(screen.getByTestId('prompt-submit')).toBeDisabled();
    expect(screen.getByTestId('prompt-submit')).toHaveTextContent('Running...');
    expect(screen.getByTestId('prompt-textarea')).toBeDisabled();
  });

  it('submits on Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: 'click the button' } });
    fireEvent.keyDown(screen.getByTestId('prompt-textarea'), { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith('click the button');
  });
});
