/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OnboardingWizard } from './OnboardingWizard';

describe('OnboardingWizard', () => {
  it('renders welcome step by default', () => {
    render(<OnboardingWizard />);
    expect(screen.getByTestId('step-content-welcome')).toBeInTheDocument();
    expect(screen.getByText(/Welcome to Automate/i)).toBeInTheDocument();
  });

  it('advances to next step when Next is clicked', () => {
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByTestId('next-button'));
    expect(screen.getByTestId('step-content-connect')).toBeInTheDocument();
  });

  it('goes back to previous step when Back is clicked', () => {
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByTestId('next-button'));
    expect(screen.getByTestId('step-content-connect')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('back-button'));
    expect(screen.getByTestId('step-content-welcome')).toBeInTheDocument();
  });

  it('does not show Back button on first step', () => {
    render(<OnboardingWizard />);
    expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
  });

  it('navigates through all steps to Done', () => {
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByTestId('next-button')); // -> Connect
    fireEvent.click(screen.getByTestId('next-button')); // -> Configure
    fireEvent.click(screen.getByTestId('next-button')); // -> Done
    expect(screen.getByTestId('step-content-done')).toBeInTheDocument();
    expect(screen.getByText(/You're all set/i)).toBeInTheDocument();
  });

  it('calls onSkip when Skip is clicked', () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId('skip-button'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete when Go to Dashboard is clicked on Done step', () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('next-button')); // -> Connect
    fireEvent.click(screen.getByTestId('next-button')); // -> Configure
    fireEvent.click(screen.getByTestId('next-button')); // -> Done
    fireEvent.click(screen.getByTestId('go-to-dashboard-button'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('hides navigation buttons on Done step', () => {
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByTestId('next-button'));
    fireEvent.click(screen.getByTestId('next-button'));
    fireEvent.click(screen.getByTestId('next-button'));
    expect(screen.queryByTestId('next-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skip-button')).not.toBeInTheDocument();
  });

  it('renders step indicator dots', () => {
    render(<OnboardingWizard />);
    expect(screen.getByTestId('step-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('step-dot-0')).toBeInTheDocument();
    expect(screen.getByTestId('step-dot-3')).toBeInTheDocument();
  });
});
