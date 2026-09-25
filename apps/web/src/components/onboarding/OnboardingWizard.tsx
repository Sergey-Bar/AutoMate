import React, { useState } from 'react';
import { Button } from '@automate/ui';

export interface OnboardingWizardProps {
  onComplete?: () => void;
  onSkip?: () => void;
  'data-testid'?: string;
}

const STEPS = ['Welcome', 'Connect', 'Configure', 'Done'] as const;
type Step = (typeof STEPS)[number];

function WelcomeStep() {
  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.5rem', fontWeight: 700 }}>
        Welcome to Automate 👋
      </h2>
      <p style={{ margin: 0, color: '#6b7280' }}>
        Let&apos;s get you set up in just a few steps. You can skip this wizard at any time and come
        back later.
      </p>
    </div>
  );
}

function ConnectStep() {
  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.5rem', fontWeight: 700 }}>
        Connect your repo
      </h2>
      <p style={{ margin: '0 0 20px', color: '#6b7280' }}>
        Link your GitHub repository to start tracking Playwright test runs.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          Repository URL
          <input
            type="text"
            placeholder="https://github.com/org/repo"
            style={{
              display: 'block',
              marginTop: '4px',
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </label>
      </div>
    </div>
  );
}

function ConfigureStep() {
  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.5rem', fontWeight: 700 }}>
        Configure settings
      </h2>
      <p style={{ margin: '0 0 20px', color: '#6b7280' }}>
        Adjust your project settings to match your workflow.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          Project name
          <input
            type="text"
            placeholder="My Playwright Project"
            style={{
              display: 'block',
              marginTop: '4px',
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </label>
      </div>
    </div>
  );
}

function DoneStep({ onComplete }: { onComplete?: () => void }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎉</div>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.5rem', fontWeight: 700 }}>
        You&apos;re all set!
      </h2>
      <p style={{ margin: '0 0 24px', color: '#6b7280' }}>
        Your project is configured and ready to go. Head to the dashboard to see your test results.
      </p>
      <Button onClick={onComplete} data-testid="go-to-dashboard-button">
        Go to Dashboard
      </Button>
    </div>
  );
}

export function OnboardingWizard({
  onComplete,
  onSkip,
  'data-testid': testId = 'onboarding-wizard',
}: OnboardingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep: Step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const handleNext = () => {
    if (!isLast) setStepIndex((i) => i + 1);
  };

  const handleBack = () => {
    if (!isFirst) setStepIndex((i) => i - 1);
  };

  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: '520px' }}>
        {/* Step indicator */}
        <div
          style={{ display: 'flex', gap: '8px', marginBottom: '24px', justifyContent: 'center' }}
          data-testid="step-indicator"
        >
          {STEPS.map((step, i) => (
            <div
              key={step}
              data-testid={`step-dot-${i}`}
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: i <= stepIndex ? '#6366f1' : '#d1d5db',
                transition: 'background-color 0.2s',
              }}
            />
          ))}
        </div>

        {/* Step content */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '32px',
            marginBottom: '16px',
          }}
          data-testid={`step-content-${currentStep.toLowerCase()}`}
        >
          {currentStep === 'Welcome' && <WelcomeStep />}
          {currentStep === 'Connect' && <ConnectStep />}
          {currentStep === 'Configure' && <ConfigureStep />}
          {currentStep === 'Done' && <DoneStep onComplete={onComplete} />}
        </div>

        {/* Navigation */}
        {!isLast && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!isFirst && (
                <Button variant="outline" onClick={handleBack} data-testid="back-button">
                  Back
                </Button>
              )}
              <Button onClick={handleNext} data-testid="next-button">
                Next
              </Button>
            </div>
            <Button variant="ghost" onClick={onSkip} data-testid="skip-button">
              Skip
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
